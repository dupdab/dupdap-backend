import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Webhook } from './entities/webhook.entity';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { NotificationPrefsService } from '../notifications/notification-prefs.service';
import {
  NotificationChannel,
  NotificationEventType,
} from '../notifications/entities/notification-preference.entity';

/** Notification events delivered to a merchant's notification webhook. */
export const NOTIFICATION_WEBHOOK_EVENTS = [
  NotificationEventType.PAYMENT_CONFIRMED,
  NotificationEventType.PAYMENT_SETTLED,
  NotificationEventType.PAYMENT_FAILED,
].map((event) => `notification.${event}`);

const isNotificationWebhook = (webhook: Webhook): boolean =>
  webhook.events.length > 0 && webhook.events.every((e) => e.startsWith('notification.'));

@Injectable()
export class NotificationWebhookService {
  private readonly logger = new Logger(NotificationWebhookService.name);

  constructor(
    @InjectRepository(Webhook) private readonly webhooksRepo: Repository<Webhook>,
    private readonly webhooks: WebhooksService,
    private readonly delivery: WebhookDeliveryService,
    private readonly prefs: NotificationPrefsService,
  ) {}

  /** Registers (or replaces) the merchant's notification webhook. The secret is only returned here. */
  async register(merchantId: string, url: string, secret?: string) {
    const existing = await this.find(merchantId);
    const created = await this.webhooks.create(
      merchantId,
      url,
      NOTIFICATION_WEBHOOK_EVENTS,
      secret,
    );
    if (existing) await this.webhooksRepo.remove(existing);

    return { id: created.id, url: created.url, events: created.events, secret: created.secret };
  }

  async get(merchantId: string) {
    const webhook = await this.find(merchantId);
    if (!webhook) throw new NotFoundException('Notification webhook not registered');
    return { id: webhook.id, url: webhook.url, events: webhook.events, isActive: webhook.isActive };
  }

  async remove(merchantId: string): Promise<void> {
    const webhook = await this.find(merchantId);
    if (!webhook) throw new NotFoundException('Notification webhook not registered');
    await this.webhooksRepo.remove(webhook);
  }

  /**
   * Sends a notification event to the merchant's notification webhook through the
   * standard webhook delivery queue (same signing and retry policy).
   */
  async notify(
    merchantId: string,
    eventType: NotificationEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    const webhook = await this.find(merchantId);
    if (!webhook?.isActive) return;

    const enabled = await this.prefs.isEnabled(merchantId, NotificationChannel.WEBHOOK, eventType);
    if (!enabled) return;

    const event = `notification.${eventType}`;
    const body = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    await this.delivery.enqueueDelivery(webhook, event, body);
    this.logger.log(`Notification webhook enqueued: webhookId=${webhook.id} event=${event}`);
  }

  private async find(merchantId: string): Promise<Webhook | undefined> {
    const hooks = await this.webhooksRepo.find({ where: { merchantId } });
    return hooks.find(isNotificationWebhook);
  }
}
