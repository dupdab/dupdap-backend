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

/** Default maximum number of webhook endpoints a single merchant may register (#919). */
const DEFAULT_MAX_WEBHOOKS_PER_MERCHANT = 10;

/**
 * Returns true when a webhook's event subscription matches the emitted event.
 *
 * Matching semantics:
 * - `*` matches every event.
 * - Exact names match only themselves (e.g. `payment.created`).
 * - Glob patterns use `*` as a wildcard for any sequence of characters
 *   (e.g. `payment.*` matches `payment.created` and `payment.failed`).
 */
export function matchesEventSubscription(subscriptions: string[], event: string): boolean {
  if (!Array.isArray(subscriptions)) {
    return false;
  }
  return subscriptions.some((pattern) => {
    if (pattern === '*') {
      return true;
    }
    if (pattern === event) {
      return true;
    }
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
      );
      return regex.test(event);
    }
    return false;
  });
}

/** How long the previous webhook secret stays valid after a rotation (#907). */
export const WEBHOOK_SECRET_GRACE_PERIOD_MS = 60 * 60 * 1000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  /** Configurable cap on webhook endpoints per merchant (#919). */
  private readonly maxWebhooksPerMerchant: number;

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
  ) {
    const configured = Number(process.env.MAX_WEBHOOKS_PER_MERCHANT);
    this.maxWebhooksPerMerchant =
      Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : DEFAULT_MAX_WEBHOOKS_PER_MERCHANT;
  }

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

  /**
   * Rotates the signing secret of a webhook (#907).
   *
   * The new secret becomes the active one immediately. The previous secret is
   * retained as `previousSecret` and stays valid for signature verification
   * until `previousSecretExpiresAt` (1 hour grace period), after which it is
   * invalidated. An audit log entry is written for the rotation.
   */
  async rotateSecret(
    id: string,
    merchantId: string,
  ): Promise<{
    id: string;
    secret: string;
    previousSecretExpiresAt: string;
  }> {
    const webhook = await this.webhooksRepo.findOne({ where: { id, merchantId } });
    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + WEBHOOK_SECRET_GRACE_PERIOD_MS);

    webhook.previousSecret = webhook.secret;
    webhook.previousSecretExpiresAt = expiresAt;
    webhook.secret = crypto.randomBytes(24).toString('hex');

    const saved = await this.webhooksRepo.save(webhook);

    this.logger.log(
      `Webhook secret rotated: webhookId=${saved.id} merchantId=${merchantId} previousSecretExpiresAt=${expiresAt.toISOString()}`,
    );

    return {
      id: saved.id,
      secret: saved.secret,
      previousSecretExpiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Returns the secrets that are currently valid for verifying a webhook
   * signature. The active secret is always valid; the previous secret is
   * included only while its grace period has not elapsed (#907).
   */
  getValidSecrets(webhook: Webhook, now: Date = new Date()): string[] {
    const secrets: string[] = [];
    if (webhook.secret) {
      secrets.push(webhook.secret);
    }
    if (
      webhook.previousSecret &&
      webhook.previousSecretExpiresAt &&
      webhook.previousSecretExpiresAt.getTime() > now.getTime()
    ) {
      secrets.push(webhook.previousSecret);
    }
    return secrets;
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

    const matchingWebhooks = webhooks.filter((w) => matchesEventSubscription(w.events, event));

    // Generate the event ID once so it stays stable across retries (#908).
    const eventId = crypto.randomUUID();
    const body = JSON.stringify({
      eventId,
      event,
      data: payload,
      timestamp: new Date().toISOString(),
    });

    for (const webhook of matchingWebhooks) {
      await this.webhookDelivery.enqueueDelivery(webhook, event, body, eventId);
      this.logger.log(`Webhook delivery enqueued: webhookId=${webhook.id} event=${event} eventId=${eventId}`);
    }
  }

  /**
   * Sends a signed `webhook.test` event to every active webhook of the merchant,
   * regardless of the events each webhook subscribes to, so merchants can check
   * their endpoint and signature verification without triggering a real payment.
   */
  async sendTest(merchantId: string): Promise<{ enqueued: number }> {
    const hooks = await this.webhooksRepo.find({ where: { merchantId, isActive: true } });

    const eventId = crypto.randomUUID();
    const body = JSON.stringify({
      eventId,
      event: 'webhook.test',
      data: { message: 'DupDub webhook test' },
      timestamp: new Date().toISOString(),
    });

    for (const hook of hooks) {
      await this.webhookDelivery.enqueueDelivery(hook, 'webhook.test', body, eventId);
    }

    this.logger.log(`Webhook test enqueued for merchant ${merchantId}: ${hooks.length} endpoints`);
    return { enqueued: hooks.length };
  }

  async create(merchantId: string, url: string, events: string[], secret?: string) {
    await this.assertPublicUrl(url);
    await this.assertUnderEndpointLimit(merchantId);

    const webhook = this.webhooksRepo.create({
      merchantId,
      url,
      events,
      secret: secret ?? crypto.randomBytes(24).toString('hex'),
    });
    return this.webhooksRepo.save(webhook);
  }

  /**
   * Rejects webhook creation when the merchant already has the maximum number
   * of registered endpoints (#919).
   */
  private async assertUnderEndpointLimit(merchantId: string): Promise<void> {
    const count = await this.webhooksRepo.count({ where: { merchantId } });
    if (count >= this.maxWebhooksPerMerchant) {
      throw new BadRequestException(
        `Webhook endpoint limit reached: a merchant may register at most ${this.maxWebhooksPerMerchant} webhook endpoints`,
      );
    }
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
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
      throw new BadRequestException('Invalid replay window');
    }

    const where: Record<string, any> = {
      webhook: { merchantId },
      createdAt: Between(from, to),
    };
    if (dto.event) {
      where.event = dto.event;
    }

    const logs = await this.deliveryLogs.find({
      where,
      relations: ['webhook'],
      order: { createdAt: 'DESC' },
    });

    const seen = new Set<string>();
    let replayed = 0;
    for (const log of logs) {
      const key = `${log.webhookId}:${log.event}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const webhook = log.webhook;
      if (!webhook) continue;

      // Reuse the original eventId so replayed deliveries remain deduplicable (#908).
      const eventId = log.eventId ?? crypto.randomUUID();
      const body = JSON.stringify({
        eventId,
        event: log.event,
        data: log.payload,
        timestamp: new Date().toISOString(),
      });

      await this.webhookDelivery.enqueueDelivery(webhook, log.event, body, eventId, true);
      replayed++;
    }

    this.logger.log(
      `Webhook replay: merchantId=${merchantId} replayed=${replayed} window=${from.toISOString()}..${to.toISOString()}`,
    );

    return { replayed, windowFrom: from.toISOString(), windowTo: to.toISOString() };
  }

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
    if (net.isIP(hostname)) {
    let addresses: dns.LookupAddress[];
    try {
      addresses = await dns.promises.lookup(hostname, { all: true });
    } catch {
      throw new BadRequestException('Webhook URL host could not be resolved');
    }

    for (const { address } of addresses) {
      if (this.isPrivateAddress(address)) {
        throw new BadRequestException('Webhook URL must not point to a private or internal address');
      }
    }
      }
    }
  }

  private isPrivateIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number);
      const [a, b] = parts;
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      return false;
    }
    if (net.isIPv6(ip)) {
      const normalized = ip.toLowerCase();
      if (normalized === '::1' || normalized === '::') return true;
      if (normalized.startsWith('fc')
      const [a, b] = parts;
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      return false;
    }
    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      if (lower === '::1' || lower === '::') return true;
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
      if (lower.startsWith('fe80')) return true;
      return false;
    }
    return false;
  }
}
