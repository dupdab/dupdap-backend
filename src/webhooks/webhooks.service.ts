import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as dns from 'dns';
import * as net from 'net';
import { Webhook } from './entities/webhook.entity';
import { WebhookDeliveryLog } from './entities/webhook-delivery-log.entity';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { CacheService } from '../cache/cache.service';
import { ReplayWebhooksDto } from './dto/replay-webhooks.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Webhook)
    private webhooksRepo: Repository<Webhook>,
    private webhookDelivery: WebhookDeliveryService,
    @Optional()
    @InjectRepository(WebhookDeliveryLog)
    private deliveryLogs?: Repository<WebhookDeliveryLog>,
    @Optional()
    private cache?: CacheService,
  ) {}

  async dispatch(merchantId: string, event: string, payload: Record<string, any>): Promise<void> {
    const webhooks = await this.webhooksRepo.find({
      where: { merchantId, isActive: true },
    });

    const matchingWebhooks = webhooks.filter(
      (w) => w.events.includes(event) || w.events.includes('*'),
    );

    const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });

    for (const webhook of matchingWebhooks) {
      await this.webhookDelivery.enqueueDelivery(webhook, event, body);
      this.logger.log(`Webhook delivery enqueued: webhookId=${webhook.id} event=${event}`);
    }
  }

  /**
   * Sends a signed `webhook.test` event to every active webhook of the merchant,
   * regardless of the events each webhook subscribes to, so merchants can check
   * their endpoint and signature verification without triggering a real payment.
   */
  async sendTest(merchantId: string): Promise<{ enqueued: number }> {
    const hooks = await this.webhooksRepo.find({ where: { merchantId, isActive: true } });

    const body = JSON.stringify({
      event: 'webhook.test',
      data: { message: 'DupDub webhook test' },
      timestamp: new Date().toISOString(),
    });

    for (const hook of hooks) {
      await this.webhookDelivery.enqueueDelivery(hook, 'webhook.test', body);
    }

    this.logger.log(`Webhook test enqueued for merchant ${merchantId}: ${hooks.length} endpoints`);
    return { enqueued: hooks.length };
  }

  async create(merchantId: string, url: string, events: string[], secret?: string) {
    await this.assertPublicUrl(url);

    const webhook = this.webhooksRepo.create({
      merchantId,
      url,
      events,
      secret: secret ?? crypto.randomBytes(24).toString('hex'),
    });
    return this.webhooksRepo.save(webhook);
  }

  async findAll(merchantId: string) {
    return this.webhooksRepo.find({ where: { merchantId } });
  }

  async remove(id: string, merchantId: string) {
    const webhook = await this.webhooksRepo.findOne({ where: { id, merchantId } });
    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }
    await this.webhooksRepo.remove(webhook);
    return webhook;
  }

  /**
   * Bulk replay of missed webhook events (#552).
   *
   * Re-enqueues the latest stored delivery per (webhook, event) inside the
   * [from, to] window, optionally filtered by event type. Rate limited to
   * 1 replay per 5 minutes per merchant. Replayed deliveries carry the
   * `X-Webhook-Replay: true` header.
   */
  async replay(
    merchantId: string,
    dto: ReplayWebhooksDto,
  ): Promise<{ replayed: number; windowFrom: string; windowTo: string }> {
    if (!this.cache || !this.deliveryLogs) {
      throw new ServiceUnavailableException('Webhook replay is currently unavailable');
    }

    const rate = await this.cache.checkSlidingWindowRateLimit(
      `webhook-replay:${merchantId}`,
      { limit: 1, windowSeconds: 5 * 60 },
    );
    if (!rate.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Webhook replay rate limit exceeded. Only 1 replay per 5 minutes is allowed.',
          retryAfter: rate.retryAfter,
          resetAt: rate.resetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException('Invalid from/to replay window');
    }

    const hooks = await this.webhooksRepo.find({ where: { merchantId, isActive: true } });
    if (hooks.length === 0) {
      return { replayed: 0, windowFrom: from.toISOString(), windowTo: to.toISOString() };
    }
    const byId = new Map(hooks.map((h) => [h.id, h]));

    const logs = await this.deliveryLogs.find({
      where: {
        webhookId: In([...byId.keys()]),
        createdAt: Between(from, to),
        ...(dto.eventType ? { event: dto.eventType } : {}),
      },
      order: { createdAt: 'DESC' },
      take: 500,
    });

    const seen = new Set<string>();
    let replayed = 0;
    for (const log of logs) {
      const key = `${log.webhookId}:${log.event}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const hook = byId.get(log.webhookId);
      if (!hook) {
        continue;
      }
      await this.webhookDelivery.enqueueDelivery(hook, log.event, log.requestBody, { replay: true });
      replayed++;
    }

    this.logger.log(`Webhook replay for merchant ${merchantId}: ${replayed} events re-enqueued`);
    return { replayed, windowFrom: from.toISOString(), windowTo: to.toISOString() };
  }

  /**
   * Resolves the webhook hostname and rejects private, loopback, and
   * link-local IP ranges to prevent SSRF against internal infrastructure.
   */
  private async assertPublicUrl(url: string): Promise<void> {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      throw new BadRequestException('Webhook URL is not a valid URL');
    }

    const addresses: string[] = [];
    if (net.isIP(hostname)) {
      addresses.push(hostname);
    } else {
      try {
        const resolved = await dns.promises.lookup(hostname, { all: true });
        addresses.push(...resolved.map((r) => r.address));
      } catch {
        throw new BadRequestException(`Webhook URL host could not be resolved: ${hostname}`);
      }
    }

    for (const address of addresses) {
      if (this.isPrivateAddress(address)) {
        throw new BadRequestException(
          `Webhook URL resolves to a private or reserved address: ${address}`,
        );
      }
    }
  }

  private isPrivateAddress(address: string): boolean {
    if (net.isIPv4(address)) {
      const [a, b] = address.split('.').map((part) => parseInt(part, 10));
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a >= 224) return true;
      return false;
    }

    if (net.isIPv6(address)) {
      const normalized = address.toLowerCase();
      if (normalized === '::1' || normalized === '::') return true;
      if (normalized.startsWith('fe80:')) return true;
      if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
      if (normalized.startsWith('::ffff:')) {
        return this.isPrivateAddress(normalized.slice('::ffff:'.length));
      }
      return false;
    }

    return true;
  }
}
