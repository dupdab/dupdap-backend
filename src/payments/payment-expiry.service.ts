import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentEvent, PaymentEventType } from './entities/payment-event.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';

/** Number of expiries in a single sweep above which a runaway-expiry alert is raised. */
export const EXPIRY_ALERT_THRESHOLD = 100;

@Injectable()
export class PaymentExpiryService {
  private readonly logger = new Logger(PaymentExpiryService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(PaymentEvent)
    private readonly events: Repository<PaymentEvent>,
    private readonly webhooks: WebhooksService,
    private readonly adminAlerts: AdminAlertService,
  ) {}

  @Cron('0 */5 * * * *')
  async sweepExpiredPayments(): Promise<number> {
    const now = new Date();
    const expired = await this.payments.find({
      where: { status: PaymentStatus.PENDING, expiresAt: LessThan(now) },
    });
    if (!expired.length) return 0;

    for (const payment of expired) {
      try {
        payment.status = PaymentStatus.EXPIRED;
        await this.payments.save(payment);

        await this.events.save(
          this.events.create({
            paymentId: payment.id,
            eventType: PaymentEventType.EXPIRED,
            previousStatus: PaymentStatus.PENDING,
            newStatus: PaymentStatus.EXPIRED,
            metadata: { reason: 'expiresAt elapsed', expiresAt: payment.expiresAt },
          }),
        );

        await this.webhooks.dispatch(payment.merchantId, 'payment.expired', {
          paymentId: payment.id,
          reference: payment.reference,
          expiresAt: payment.expiresAt,
        });
      } catch (err) {
        this.logger.error(
          `Failed to expire payment ${payment.id}: ${(err as Error).message}`,
        );
      }
    }

    if (expired.length > EXPIRY_ALERT_THRESHOLD) {
      await this.adminAlerts.raise({
        type: AdminAlertType.TRANSACTION_LIMIT,
        dedupeKey: `payment-expiry-runaway:${now.toISOString().slice(0, 13)}`,
        message: `Runaway payment expiry: ${expired.length} payments expired in a single sweep`,
        metadata: { expiredCount: expired.length, threshold: EXPIRY_ALERT_THRESHOLD },
        thresholdValue: expired.length,
      });
    }

    return expired.length;
  }
}
