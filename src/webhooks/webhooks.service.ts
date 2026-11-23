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
import { Merchant } from '../merchants/entities/merchant.entity';
import { UpdateWebhookRetryConfigDto } from './dto/update-webhook-retry-config.dto';

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
    @Optional()
    @InjectRepository(Merchant)
    private merchantsRepo?: Repository<Merchant>,
  ) {}

  /** Admin: close an open webhook circuit and clear the failure streak (#457). */
  async resetCircuit(webhookId: string): Promise<Webhook> {
    const webhook = await this.webhooksRepo.findOne({ where: { id: webhookId } });
    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }
    webhook.circuitOpenUntil = null;
    webhook.failureCount = 0;
    return this.webhooksRepo.save(webhook);
  }

  async updateRetryConfig(merchantId: string, config: UpdateWebhookRetryConfigDto) {
    if (!this.merchantsRepo) throw new Error('Merchant repository is unavailable');
    const merchant = await this.merchantsRepo.findOne({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    merchant.webhookRetryConfig = config;
    await this.merchantsRepo.save(merchant);
    return merchant.webhookRetryConfig;
  }

  async getRetryConfig(merchantId: string) {
    if (!this.merchantsRepo) throw new Error('Merchant repository is unavailable');
    const merchant = await this.merchantsRepo.findOne({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    return merchant.webhookRetryConfig;
  }

  async dispatch(merchantId: string, event: string, payload: Record<string, any>): Promise<void> {
    const webhooks = await this.webhooksRepo.find({
      where: { merchantId, isActive: true },
    });

    const matchingWebhooks = webhooks.filter(
      (w) => w.events.includes(event) || w.events.includes('*'),
    );

    const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });

    for (const webhook of matchingWebhooks) {
      if (!(await this.assertDeliverySafe(webhook))) {
        continue;
      }
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

    let enqueued = 0;
    for (const hook of hooks) {
      if (!(await this.assertDeliverySafe(hook))) {
        continue;
      }
      await this.webhookDelivery.enqueueDelivery(hook, 'webhook.test', body);
      enqueued++;
    }

    this.logger.log(`Webhook test enqueued for merchant ${merchantId}: ${enqueued} endpoints`);
    return { enqueued };
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
      if (!(await this.assertDeliverySafe(hook))) {
        continue;
      }
      await this.webhookDelivery.enqueueDelivery(hook, log.event, log.requestBody, { replay: true });
      replayed++;
    }

    this.logger.log(`Webhook replay for merchant ${merchantId}: ${replayed} events re-enqueued`);
    return { replayed, windowFrom: from.toISOString(), windowTo: to.toISOString() };
  }

  /**
   * Determines whether a webhook response should be counted as a successful
   * delivery (#912). A 2xx status alone is not enough: the endpoint must also
   * return a JSON content type, otherwise an HTML error page served with a
   * 200 OK would be silently treated as success.
   */
  isSuccessfulResponse(status: number, contentType?: string | null): boolean {
    if (status < 200 || status >= 300) {
      return false;
    }
    const mediaType = (contentType ?? '').split(';')[0].trim().toLowerCase();
    return mediaType === 'application/json';
  }

  /**
   * Records the outcome of a delivery attempt, logging the response body when
   * the delivery failed so merchants and operators can debug the endpoint.
   */
  logDeliveryResult(
    webhookId: string,
    event: string,
    status: number,
    contentType: string | null | undefined,
    responseBody: string | null | undefined,
  ): boolean {
    const success = this.isSuccessfulResponse(status, contentType);
    if (!success) {
      this.logger.warn(
        `Webhook delivery failed: webhookId=${webhookId} event=${event} status=${status} ` +
          `contentType=${contentType ?? 'none'} body=${responseBody ?? ''}`,
      );
    }
    return success;
  }

  /**
   * Re-resolves the webhook hostname on every delivery attempt to defend
   * against DNS rebinding (#909). Returns false and alerts admins when the
   * hostname now maps to a private/internal address, so the delivery is
   * rejected instead of reaching internal services.
   */
  private async assertDeliverySafe(webhook: Webhook): Promise<boolean> {
    try {
      await this.assertPublicUrl(webhook.url);
      return true;
    } catch (err) {
      this.logger.warn(
        `Webhook delivery blocked for webhookId=${webhook.id}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Rejects URLs that resolve to private, loopback, link-local or otherwise
   * non-public addresses to prevent SSRF (#909).
   */
  private async assertPublicUrl(url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid webhook URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Webhook URL must use http or https');
    }

    const hostname = parsed.hostname;
    const addresses = net.isIP(hostname)
      ? [{ address: hostname }]
      : await dns.promises.lookup(hostname, { all: true });

    for (const { address } of addresses) {
      if (this.isPrivateAddress(address)) {
        throw new BadRequestException('Webhook URL resolves to a private address');
      }
    }
  }

  private isPrivateAddress(address: string): boolean {
    if (net.isIPv4(address)) {
      const parts = address.split('.').map(Number);
      const [a, b] = parts;
      if (a === 10 || a === 127 || a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      return false;
    }
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) {
      return this.isPrivateAddress(lower.slice('::ffff:'.length));
    }
    return false;
  }
}
