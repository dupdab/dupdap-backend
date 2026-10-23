import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, UpdateEvent } from 'typeorm';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
import { NotificationEventType } from '../notifications/entities/notification-preference.entity';
import { NotificationWebhookService } from './notification-webhook.service';

const STATUS_EVENTS: Partial<Record<PaymentStatus, NotificationEventType>> = {
  [PaymentStatus.CONFIRMED]: NotificationEventType.PAYMENT_CONFIRMED,
  [PaymentStatus.SETTLED]: NotificationEventType.PAYMENT_SETTLED,
  [PaymentStatus.FAILED]: NotificationEventType.PAYMENT_FAILED,
};

/** Forwards payment status transitions to the merchant's notification webhook. */
@Injectable()
export class PaymentNotificationSubscriber implements EntitySubscriberInterface<Payment> {
  private readonly logger = new Logger(PaymentNotificationSubscriber.name);

  constructor(
    dataSource: DataSource,
    private readonly notificationWebhooks: NotificationWebhookService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return Payment;
  }

  async afterUpdate(event: UpdateEvent<Payment>): Promise<void> {
    const payment = event.entity as Payment | undefined;
    const previous = event.databaseEntity?.status;
    if (!payment?.merchantId || !payment.status || payment.status === previous) return;

    const eventType = STATUS_EVENTS[payment.status];
    if (!eventType) return;

    try {
      await this.notificationWebhooks.notify(payment.merchantId, eventType, {
        paymentId: payment.id,
        reference: payment.reference,
        status: payment.status,
        amountUsd: payment.amountUsd,
      });
    } catch (err) {
      // Notification delivery must never roll back the payment update
      this.logger.error(
        `Notification webhook failed for payment ${payment.id}: ${(err as Error).message}`,
      );
    }
  }
}
