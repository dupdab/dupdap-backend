import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurringPayment, RecurringPaymentStatus } from './entities/recurring-payment.entity';
import { CreateRecurringPaymentDto } from './dto/create-recurring-payment.dto';
import { Merchant } from '../merchants/entities/merchant.entity';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { CronJobService } from '../cron/cron-job.service';

/** How long before a charge the merchant is notified. */
const NOTIFY_LEAD_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RecurringPaymentsService {
  private readonly logger = new Logger(RecurringPaymentsService.name);

  constructor(
    @InjectRepository(RecurringPayment)
    private readonly recurringRepo: Repository<RecurringPayment>,
    @InjectRepository(Merchant)
    private readonly merchantsRepo: Repository<Merchant>,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
    private readonly cronJobService: CronJobService,
  ) {}

  async create(merchantId: string, dto: CreateRecurringPaymentDto): Promise<RecurringPayment> {
    const subscription = this.recurringRepo.create({
      merchantId,
      amountUsd: String(dto.amountUsd),
      description: dto.description,
      intervalDays: dto.intervalDays,
      status: RecurringPaymentStatus.ACTIVE,
      nextChargeAt: dto.startAt ? new Date(dto.startAt) : new Date(),
      notifiedForChargeAt: null,
    });
    return this.recurringRepo.save(subscription);
  }

  async cancel(id: string, merchantId: string): Promise<void> {
    const subscription = await this.recurringRepo.findOne({ where: { id, merchantId } });
    if (!subscription) throw new NotFoundException('Recurring payment not found');

    subscription.status = RecurringPaymentStatus.CANCELLED;
    await this.recurringRepo.save(subscription);
  }

  /**
   * Runs every minute. Emails the merchant once per upcoming charge, shortly
   * before the charge is due.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async notifyUpcomingCharges(): Promise<void> {
    await this.cronJobService.run('recurring-payment-notify', async () => {
      const windowEnd = new Date(Date.now() + NOTIFY_LEAD_MS);

      const upcoming = (
        await this.recurringRepo.find({
          where: { status: RecurringPaymentStatus.ACTIVE, nextChargeAt: LessThanOrEqual(windowEnd) },
        })
      ).filter((s) => s.notifiedForChargeAt?.getTime() !== s.nextChargeAt.getTime());

      for (const subscription of upcoming) {
        try {
          const merchant = await this.merchantsRepo.findOne({
            where: { id: subscription.merchantId },
            select: ['id', 'email', 'businessName'],
          });
          if (!merchant) continue;

          const chargeAt = subscription.nextChargeAt;
          await this.emailService.queue(
            merchant.email,
            'recurring-payment-upcoming',
            {
              subject: `Upcoming recurring payment of $${subscription.amountUsd} on ${chargeAt.toUTCString()}`,
              merchantName: merchant.businessName,
              amountUsd: subscription.amountUsd,
              description: subscription.description ?? 'Recurring payment',
              recurringPaymentId: subscription.id,
              chargeAt: chargeAt.toUTCString(),
            },
            merchant.id,
          );

          await this.recurringRepo.update(subscription.id, { notifiedForChargeAt: chargeAt });
        } catch (error) {
          this.logger.error(
            `Failed to notify merchant about recurring payment ${subscription.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    });
  }

  /**
   * Runs every minute. Creates a payment request for each recurring payment
   * that is due and whose merchant has already been notified.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async chargeDueSubscriptions(): Promise<void> {
    await this.cronJobService.run('recurring-payment-charge', async () => {
      const now = new Date();

      const due = (
        await this.recurringRepo.find({
          where: { status: RecurringPaymentStatus.ACTIVE, nextChargeAt: LessThanOrEqual(now) },
        })
      ).filter((s) => s.notifiedForChargeAt?.getTime() === s.nextChargeAt.getTime());

      for (const subscription of due) {
        const chargeAt = subscription.nextChargeAt;
        // Claim the cycle before charging so overlapping runs cannot double-charge.
        const claim = await this.recurringRepo.update(
          { id: subscription.id, nextChargeAt: chargeAt },
          { nextChargeAt: new Date(chargeAt.getTime() + subscription.intervalDays * DAY_MS) },
        );
        if (!claim.affected) continue;

        try {
          await this.paymentsService.create(subscription.merchantId, {
            amountUsd: Number(subscription.amountUsd),
            description: subscription.description ?? undefined,
          });
        } catch (error) {
          // Release the claim so the charge is retried on the next run.
          await this.recurringRepo.update(subscription.id, { nextChargeAt: chargeAt });
          this.logger.error(
            `Failed to create payment for recurring payment ${subscription.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    });
  }
}
