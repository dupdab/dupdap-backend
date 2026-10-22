import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_NAMES, DEFAULT_QUEUE_JOB } from '../queues/queue.constants';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, FindManyOptions, Between, IsNull, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Big from 'big.js';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { Settlement, SettlementStatus } from './entities/settlement.entity';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';
import { AdminSettlementsQueryDto } from './dto/admin-settlements-query.dto';
import { EmailService } from '../email/email.service';
import { MerchantsService } from '../merchants/merchants.service';
import { NotificationPrefsService } from '../notifications/notification-prefs.service';
import {
  NotificationChannel,
  NotificationEventType,
} from '../notifications/entities/notification-preference.entity';
import { StellarService } from '../stellar/stellar.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CronJobService } from '../cron/cron-job.service';
import { RetryConfigService } from '../retry/retry-config.service';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import {
  SettlementNotFoundException,
  SettlementNotPendingApprovalException,
  SettlementNotRetryableException,
  SettlementPartnerException,
} from '../common/exceptions/settlement.exceptions';

export interface PartnerCallbackPayload {
  reference: string;
  status: 'success' | 'failed';
  failureReason?: string;
}

/** Fee audit report for a single settlement (#554). */
export interface SettlementFeeBreakdown {
  settlementId: string;
  merchantId: string;
  grossAmount: string;
  feeRate: string;
  feeAmount: string;
  netAmount: string;
  tierApplied: string;
  fiatCurrency: string | null;
}

const SMALL_BATCH_THRESHOLD_USD = 10;
const MAX_BATCH_PAYMENT_COUNT = 50;
const BATCH_WINDOW_MINUTES = 15;
const BATCH_FEE_RATE = 0.015;

/**
 * Maps a merchant's country to the fiat currency their settlements are
 * denominated in. Falls back to USD for unknown countries so we never
 * silently record a settlement in the wrong currency.
 */
const COUNTRY_TO_SETTLEMENT_CURRENCY: Record<string, string> = {
  NG: 'NGN',
  US: 'USD',
  GB: 'GBP',
  AU: 'AUD',
};

const DEFAULT_SETTLEMENT_CURRENCY = 'USD';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  /** Short lived CSV exports handed out to merchants. */
  private readonly csvExports = new Map<
    string,
    { fileName: string; fileData: string; expiresAt: number }
  >();

  constructor(
    @InjectRepository(Settlement)
    private settlementsRepo: Repository<Settlement>,
    @InjectRepository(Payment)
    private paymentsRepo: Repository<Payment>,
    private config: ConfigService,
    private webhooks: WebhooksService,
    private adminAlerts: AdminAlertService,
    private analytics: AnalyticsService,
    private emailService: EmailService,
    private merchantsService: MerchantsService,
    private notificationPrefs: NotificationPrefsService,
    @Inject(forwardRef(() => StellarService))
    private stellar: StellarService,
    @InjectQueue(QUEUE_NAMES.settlement)
    private settlementQueue: Queue,
    private cronJobService: CronJobService,
    private retryConfig: RetryConfigService,
    private auditService: AuditService,
  ) {}

  private invalidateAnalyticsForMerchant(merchantId: string): void {
    this.analytics.clearCacheForMerchant(merchantId);
  }

  private toBig(value: number | string): Big {
    return new Big(value);
  }

  /**
   * Resolves the fiat currency a merchant's settlements should be denominated
   * in, based on the merchant's country. Never hardcodes a single currency.
   */
  private async resolveSettlementCurrency(merchantId: string): Promise<string> {
    try {
      const merchant = await this.merchantsService.findOne(merchantId);
      const country = merchant?.country?.toUpperCase();
      if (country && COUNTRY_TO_SETTLEMENT_CURRENCY[country]) {
        return COUNTRY_TO_SETTLEMENT_CURRENCY[country];
      }
      this.logger.warn(
        `No settlement currency mapping for merchant ${merchantId} (country: ${merchant?.country ?? 'unknown'}); defaulting to ${DEFAULT_SETTLEMENT_CURRENCY}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to resolve settlement currency for merchant ${merchantId}; defaulting to ${DEFAULT_SETTLEMENT_CURRENCY}`,
      );
    }
    return DEFAULT_SETTLEMENT_CURRENCY;
  }

  async initiateSettlement(payment: Payment, manager?: EntityManager): Promise<void> {
    const settlementsRepo = manager?.getRepository(Settlement) ?? this.settlementsRepo;
    const paymentsRepo = manager?.getRepository(Payment) ?? this.paymentsRepo;
    // Respect merchant settlement preference: DAILY/WEEKLY merchants are
    // batched by the scheduled cron jobs below; only INSTANT settles here.
    try {
      const merchant = await this.merchantsService.findOne(payment.merchantId);
      const frequency = (merchant as { settlementFrequency?: string })?.settlementFrequency;
      if (frequency && frequency !== 'INSTANT') {
        this.logger.debug(
          `Payment ${payment.id} deferred: merchant prefers ${frequency} settlement.`,
        );
        return;
      }
    } catch {
      // Fall through to default instant behavior if preference is unreadable.
    }
    const amountUsd = this.toBig(payment.amountUsd);
    if (amountUsd.lt(SMALL_BATCH_THRESHOLD_USD)) {
      this.logger.debug(
        `Payment ${payment.id} below ${SMALL_BATCH_THRESHOLD_USD} USD batch threshold; waiting for batch window.`,
      );
      return;
    }

    const feeUsd = amountUsd.times(BATCH_FEE_RATE);
    const netUsd = amountUsd.minus(feeUsd);
    const LARGE_SETTLEMENT_THRESHOLD = 10000;

    const fiatCurrency = await this.resolveSettlementCurrency(payment.merchantId);

    const settlement = settlementsRepo.create({
      merchantId: payment.merchantId,
      totalAmountUsd: amountUsd.toFixed(6),
      feeAmountUsd: feeUsd.toFixed(6),
      netAmountUsd: netUsd.toFixed(6),
      fiatCurrency,
      status: netUsd.gte(LARGE_SETTLEMENT_THRESHOLD)
        ? SettlementStatus.PENDING_APPROVAL
        : SettlementStatus.PROCESSING,
      requiresApproval: netUsd.gte(LARGE_SETTLEMENT_THRESHOLD),
    });

    const saved = await settlementsRepo.save(settlement);

    payment.status = PaymentStatus.SETTLING;
    payment.feeUsd = feeUsd.toFixed(6);
    payment.settlementId = saved.id;
    await paymentsRepo.save(payment);

    await this.webhooks.dispatch(payment.merchantId, 'payment.settling', {
      paymentId: payment.id,
      settlementId: saved.id,
    });

    // Only execute transfer if no approval required
    if (!settlement.requiresApproval) {
      this.logger.debug(`Enqueuing settlement job for ${saved.id}`);
      await this.enqueueSettlement(saved.id);
    } else {
      // Alert admin about large settlement requiring approval
      await this.adminAlerts.raise({
        type: AdminAlertType.SETTLEMENT_FAILURE, // Reusing existing type for now
        dedupeKey: `large-settlement:${saved.id}`,
        message: `Large settlement ${saved.id} requires manual approval: $${netUsd.toFixed(2)}`,
        metadata: {
          merchantId: saved.merchantId,
          paymentId: payment.id,
          amount: netUsd.toFixed(6),
        },
        thresholdValue: 1,
      });
    }
  }

  private async enqueueSettlement(settlementId: string): Promise<void> {
    const settlementRetry = this.retryConfig.settlement;
    await this.settlementQueue.add(
      DEFAULT_QUEUE_JOB,
      { settlementId },
      {
        attempts: settlementRetry.maxAttempts + 1,
        backoff: { type: 'fixed', delay: settlementRetry.delaysMs[0] ?? 60_000 },
        removeOnFail: false,
      },
    );
  }

  @Cron('0 */15 * * * *')
  async batchSmallConfirmedPayments(): Promise<void> {
    await this.cronJobService.run('batch-small-confirmed-payments', async () => {
      const confirmedPayments = await this.paymentsRepo.find({
        where: {
          status: PaymentStatus.CONFIRMED,
          settlementId: IsNull(),
          amountUsd: LessThan(SMALL_BATCH_THRESHOLD_USD),
        },
        order: {
          merchantId: 'ASC',
          confirmedAt: 'ASC',
          createdAt: 'ASC',
        },
      });

      if (confirmedPayments.length === 0) {
        return 0;
      }

      const groups = new Map<string, Payment[]>();
      for (const payment of confirmedPayments) {
        const list = groups.get(payment.merchantId) ?? [];
        list.push(payment);
        groups.set(payment.merchantId, list);
      }

      for (const payments of groups.values()) {
        await this.flushMerchantBatch(payments);
      }

      return confirmedPayments.length;
    });
  }

  /** End-of-day batch for merchants preferring DAILY settlement. */
  @Cron('0 0 * * * *')
  async batchDailyPreferredPayments(): Promise<void> {
    await this.cronJobService.run('batch-daily-preferred-payments', async () => {
      return this.flushScheduledPreference('DAILY');
    });
  }

  /** Weekly batch for merchants preferring WEEKLY settlement (Monday 00:00). */
  @Cron('0 0 * * 1')
  async batchWeeklyPreferredPayments(): Promise<void> {
    await this.cronJobService.run('batch-weekly-preferred-payments', async () => {
      return this.flushScheduledPreference('WEEKLY');
    });
  }

  private async flushScheduledPreference(frequency: 'DAILY' | 'WEEKLY'): Promise<number> {
    const pending = await this.paymentsRepo.find({
      where: { status: PaymentStatus.CONFIRMED, settlementId: IsNull() },
      order: { merchantId: 'ASC', confirmedAt: 'ASC', createdAt: 'ASC' },
    });
    if (pending.length === 0) {
      return 0;
    }
    const groups = new Map<string, Payment[]>();
    for (const payment of pending) {
      const list = groups.get(payment.merchantId) ?? [];
      list.push(payment);
      groups.set(payment.merchantId, list);
    }
    let flushed = 0;
    for (const [merchantId, payments] of groups) {
      let preferred: string | undefined;
      try {
        const merchant = await this.merchantsService.findOne(merchantId);
        preferred = (merchant as { settlementFrequency?: string })?.settlementFrequency;
      } catch {
        continue;
      }
      if (preferred !== frequency) {
        continue;
      }
      await this.createBatchSettlement(payments);
      flushed += payments.length;
    }
    return flushed;
  }

  private async flushMerchantBatch(payments: Payment[]): Promise<void> {
    const ordered = [...payments].sort(
      (a, b) =>
        new Date(a.confirmedAt ?? a.createdAt).getTime() -
        new Date(b.confirmedAt ?? b.createdAt).getTime(),
    );

    let batch: Payment[] = [];
    let runningTotal = new Big(0);

    for (const payment of ordered) {
      batch.push(payment);
      runningTotal = runningTotal.plus(this.toBig(payment.amountUsd));

      const oldest = batch[0];
      const oldestAt = new Date(oldest.confirmedAt ?? oldest.createdAt).getTime();
      const isOldEnough = Date.now() - oldestAt >= BATCH_WINDOW_MINUTES * 60 * 1000;
      const shouldFlush =
        runningTotal.gte(SMALL_BATCH_THRESHOLD_USD) ||
        batch.length >= MAX_BATCH_PAYMENT_COUNT ||
        isOldEnough;

      if (shouldFlush) {
        await this.createBatchSettlement(batch);
        batch = [];
        runningTotal = new Big(0);
      }
    }
  }

  private async createBatchSettlement(payments: Payment[]): Promise<void> {
    if (payments.length === 0) {
      return;
    }

    const totalAmountUsd = payments.reduce(
      (sum, payment) => sum.plus(this.toBig(payment.amountUsd)),
      new Big(0),
    );
    const feeAmountUsd = totalAmountUsd.times(BATCH_FEE_RATE);
    const netAmountUsd = totalAmountUsd.minus(feeAmountUsd);

    const fiatCurrency = await this.resolveSettlementCurrency(payments[0].merchantId);

    const settlement = this.settlementsRepo.create({
      merchantId: payments[0].merchantId,
      totalAmountUsd: totalAmountUsd.toFixed(6),
      feeAmountUsd: feeAmountUsd.toFixed(6),
      netAmountUsd: netAmountUsd.toFixed(6),
      fiatCurrency,
      status: netAmountUsd.gte(10000)
        ? SettlementStatus.PENDING_APPROVAL
        : SettlementStatus.PROCESSING,
      requiresApproval: netAmountUsd.gte(10000),
    });

    const saved = await this.settlementsRepo.save(settlement);

    for (const payment of payments) {
      payment.status = PaymentStatus.SETTLING;
      payment.feeUsd = this.toBig(payment.amountUsd).times(BATCH_FEE_RATE).toFixed(6);
      payment.settlementId = saved.id;
    }

    await this.paymentsRepo.save(payments);

    await this.webhooks.dispatch(payments[0].merchantId, 'settlement.created', {
      settlementId: saved.id,
      paymentIds: payments.map((p) => p.id),
      fiatCurrency: saved.fiatCurrency,
    });

    if (!saved.requiresApproval) {
      await this.enqueueSettlement(saved.id);
    } else {
      await this.adminAlerts.raise({
        type: AdminAlertType.SETTLEMENT_FAILURE,
        dedupeKey: `large-settlement:${saved.id}`,
        message: `Large batch settlement ${saved.id} requires manual approval: $${netAmountUsd.toFixed(2)}`,
        metadata: {
          merchantId: saved.merchantId,
          paymentIds: payments.map((p) => p.id),
          amount: netAmountUsd.toFixed(6),
        },
        thresholdValue: 1,
      });
    }
  }

  async executeFiatTransfer(settlement: Settlement): Promise<void> {
    const partnerUrl = this.config.get<string>('SETTLEMENT_PARTNER_URL');
    const partnerApiKey = this.config.get<string>('SETTLEMENT_PARTNER_API_KEY');

    if (!partnerUrl || !partnerApiKey) {
      throw new SettlementPartnerException();
    }

    await axios.post(
      `${partnerUrl}/transfers`,
      {
        reference: settlement.id,
        amount: settlement.netAmountUsd,
        currency: settlement.fiatCurrency,
        merchantId: settlement.merchantId,
      },
      {
        headers: {
          Authorization: `Bearer ${partnerApiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );
  }

  async processSettlement(settlementId: string): Promise<void> {
    const settlement = await this.settlementsRepo.findOne({ where: { id: settlementId } });
    if (!settlement) {
      throw new NotFoundException(`Settlement ${settlementId} not found`);
    }

    if (settlement.status !== SettlementStatus.PROCESSING) {
      this.logger.warn(`Settlement ${settlementId} is not in PROCESSING state; skipping`);
      return;
    }

    try {
      await this.executeFiatTransfer(settlement);
      settlement.status = SettlementStatus.COMPLETED;
      settlement.completedAt = new Date();
      await this.settlementsRepo.save(settlement);
      await this.paymentsRepo.update({ settlementId: settlement.id, status: PaymentStatus.SETTLING }, { status: PaymentStatus.SETTLED });
      this.invalidateAnalyticsForMerchant(settlement.merchantId);
      await this.webhooks.dispatch(settlement.merchantId, 'settlement.completed', {
        settlementId: settlement.id,
      });
    } catch (error) {
      this.logger.error(`Settlement ${settlementId} failed: ${(error as Error).message}`);
      settlement.status = SettlementStatus.FAILED;
      settlement.failureReason = (error as Error).message;
      await this.settlementsRepo.save(settlement);
      this.invalidateAnalyticsForMerchant(settlement.merchantId);
      await this.adminAlerts.raise({
        type: AdminAlertType.SETTLEMENT_FAILURE,
        dedupeKey: `settlement-failed:${settlement.id}`,
        message: `Settlement ${settlement.id} failed: ${(error as Error).message}`,
        metadata: { merchantId: settlement.merchantId },
        thresholdValue: 1,
      });
      throw error;
    }
  }

  /**
   * Approves a settlement that is waiting for a SUPERADMIN decision (#445).
   *
   * The settlement moves to `processing`, the fiat transfer is enqueued and the
   * merchant is notified by email. Every decision is written to the audit log.
   */
  async approveSettlement(settlementId: string, adminId: string): Promise<Settlement> {
    const settlement = await this.settlementsRepo.findOne({ where: { id: settlementId } });
    if (!settlement) {
      throw new SettlementNotFoundException(settlementId);
    }

    if (settlement.status !== SettlementStatus.PENDING_APPROVAL) {
      throw new SettlementNotPendingApprovalException(settlement.status);
    }

    settlement.status = SettlementStatus.PROCESSING;
    settlement.approvedBy = adminId;
    settlement.approvedAt = new Date();
    const saved = await this.settlementsRepo.save(settlement);

    await this.enqueueSettlement(saved.id);

    await this.auditService.log({
      actor: adminId,
      action: 'SETTLEMENT_APPROVED',
      resource: `settlement:${saved.id}`,
      before: { status: SettlementStatus.PENDING_APPROVAL },
      after: { status: saved.status, approvedAt: saved.approvedAt },
    });

    await this.notifyMerchantOfDecision(saved, 'settlement-approved');

    return saved;
  }

  /**
   * Rejects a settlement that is waiting for a SUPERADMIN decision (#445).
   *
   * The settlement is marked `rejected`, the reason is stored and shown to the
   * merchant and every decision is written to the audit log.
   */
  async rejectSettlement(
    settlementId: string,
    adminId: string,
    reason: string,
  ): Promise<Settlement> {
    const settlement = await this.settlementsRepo.findOne({ where: { id: settlementId } });
    if (!settlement) {
      throw new SettlementNotFoundException(settlementId);
    }

    if (settlement.status !== SettlementStatus.PENDING_APPROVAL) {
      throw new SettlementNotPendingApprovalException(settlement.status);
    }

    settlement.status = SettlementStatus.REJECTED;
    settlement.rejectedBy = adminId;
    settlement.rejectedAt = new Date();
    settlement.rejectionReason = reason;
    const saved = await this.settlementsRepo.save(settlement);

    await this.auditService.log({
      actor: adminId,
      action: 'SETTLEMENT_REJECTED',
      resource: `settlement:${saved.id}`,
      before: { status: SettlementStatus.PENDING_APPROVAL },
      after: { status: saved.status, reason, rejectedAt: saved.rejectedAt },
    });

    await this.notifyMerchantOfDecision(saved, 'settlement-rejected');

    return saved;
  }

  /** Notifies the merchant about an approval/rejection decision. */
  private async notifyMerchantOfDecision(
    settlement: Settlement,
    templateAlias: 'settlement-approved' | 'settlement-rejected',
  ): Promise<void> {
    let recipient: string | null = null;
    let merchantName = 'there';

    try {
      const merchant = await this.merchantsService.findOne(settlement.merchantId);
      recipient = merchant?.email ?? null;
      merchantName = merchant?.businessName ?? merchant?.email ?? 'there';
    } catch (error) {
      this.logger.warn(
        `Could not resolve merchant ${settlement.merchantId} for settlement notification: ${(error as Error).message}`,
      );
    }

    if (!recipient) {
      this.logger.warn(
        `No merchant email for settlement ${settlement.id}; skipping ${templateAlias} notification`,
      );
      return;
    }

    try {
      await this.emailService.queue(
        recipient,
        templateAlias,
        {
          subject:
            templateAlias === 'settlement-approved'
              ? `Settlement ${settlement.id} approved`
              : `Settlement ${settlement.id} rejected`,
          merchantName,
          settlementId: settlement.id,
          status: settlement.status,
          totalAmountUsd: settlement.totalAmountUsd,
          feeAmountUsd: settlement.feeAmountUsd,
          netAmountUsd: settlement.netAmountUsd,
          fiatCurrency: settlement.fiatCurrency ?? null,
          rejectionReason: settlement.rejectionReason ?? null,
        },
        settlement.merchantId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue ${templateAlias} email for settlement ${settlement.id}: ${(error as Error).message}`,
      );
    }
  }

  async findForMerchant(
    merchantId: string,
    options: FindManyOptions<Settlement> = {},
  ): Promise<Settlement[]> {
    return this.settlementsRepo.find({
      ...options,
      where: { ...(options.where as object), merchantId },
      order: options.order ?? { createdAt: 'DESC' },
    });
  }

  async findOneForMerchant(merchantId: string, settlementId: string): Promise<Settlement> {
    const settlement = await this.settlementsRepo.findOne({
      where: { id: settlementId, merchantId },
    });
    if (!settlement) {
      throw new NotFoundException(`Settlement ${settlementId} not found`);
    }
    return settlement;
  }

  /**
   * Fee audit report for a merchant settlement (#554): gross amount, applied
   * fee rate, fee amount, net amount and the fee tier that was applied.
   */
  private toFeeBreakdown(merchantId: string, settlement: Settlement): SettlementFeeBreakdown {
    const gross = this.toBig(settlement.totalAmountUsd);
    const fee = this.toBig(settlement.feeAmountUsd);
    const feeRate = gross.eq(0) ? new Big(0) : fee.div(gross);
    return {
      settlementId: settlement.id,
      merchantId,
      grossAmount: settlement.totalAmountUsd,
      feeRate: feeRate.toFixed(6),
      feeAmount: settlement.feeAmountUsd,
      netAmount: settlement.netAmountUsd,
      tierApplied: feeRate.eq(BATCH_FEE_RATE) ? 'standard' : 'custom',
      fiatCurrency: settlement.fiatCurrency ?? null,
    };
  }

  async getFeeBreakdown(merchantId: string, settlementId: string): Promise<SettlementFeeBreakdown> {
    const settlement = await this.findOneForMerchant(merchantId, settlementId);
    return this.toFeeBreakdown(merchantId, settlement);
  }

  /**
   * CSV export of a merchant's settlements including the fee breakdown (#554).
   */
  async exportCsvForMerchant(merchantId: string): Promise<string> {
    const settlements = await this.findForMerchant(merchantId);
    const header =
      'settlement_id,merchant_id,gross_amount_usd,fee_rate,fee_amount_usd,net_amount_usd,tier_applied,fiat_currency,status,created_at';
    const lines = settlements.map((settlement) => {
      const breakdown = this.toFeeBreakdown(merchantId, settlement);
      return [
        breakdown.settlementId,
        breakdown.merchantId,
        breakdown.grossAmount,
        breakdown.feeRate,
        breakdown.feeAmount,
        breakdown.netAmount,
        breakdown.tierApplied,
        breakdown.fiatCurrency ?? '',
        settlement.status,
        settlement.createdAt?.toISOString() ?? '',
      ].join(',');
    });
    return [header, ...lines].join('\n');
  }

  /**
   * Builds the CSV export of a settlement and emails it to the merchant.
   * Used by the export queue processor.
   */
  async generateCsvExport(settlementExportId: string): Promise<void> {
    const settlement = await this.settlementsRepo.findOne({
      where: { id: settlementExportId },
    });
    if (!settlement) {
      throw new SettlementNotFoundException(settlementExportId);
    }

    const csv = await this.exportCsvForMerchant(settlement.merchantId);

    let recipient: string | null = null;
    let merchantName = 'there';
    try {
      const merchant = await this.merchantsService.findOne(settlement.merchantId);
      recipient = merchant?.email ?? null;
      merchantName = merchant?.businessName ?? merchant?.email ?? 'there';
    } catch {
      recipient = null;
    }

    if (!recipient) {
      this.logger.warn(
        `No merchant email for settlement export ${settlement.id}; skipping email`,
      );
      return;
    }

    await this.emailService.queue(
      recipient,
      'settlement-export',
      {
        subject: `Settlement export ${settlement.id}`,
        merchantName,
        settlementId: settlement.id,
        csv,
      },
      settlement.merchantId,
    );
  }


  /** Paginated settlement list for a merchant. */
  async findAll(
    merchantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponseDto<Settlement>> {
    const safeLimit = Math.max(1, Math.min(100, limit));
    const [items, total] = await this.settlementsRepo.findAndCount({
      where: { merchantId },
      order: { createdAt: 'DESC' },
      skip: Math.max(0, (page - 1) * safeLimit),
      take: safeLimit,
    });

    return PaginatedResponseDto.of(items, total, page, safeLimit);
  }

  /**
   * Applies the on-chain settlement completion event emitted by the Soroban
   * contract (#445) — the settlement is marked completed and the merchant is
   * notified.
   */
  async applySorobanSettlementCompleted(event: {
    settlementId?: string;
    reference?: string;
    partnerReference?: string;
    txHash?: string;
  }): Promise<void> {
    const settlementId = event.settlementId ?? event.reference;
    if (!settlementId) {
      this.logger.warn('Received settlement.completed event without a settlement id');
      return;
    }

    const settlement = await this.settlementsRepo.findOne({
      where: { id: settlementId },
    });
    if (!settlement) {
      this.logger.warn(`Received settlement.completed event for unknown settlement ${settlementId}`);
      return;
    }

    if (settlement.status === SettlementStatus.COMPLETED) {
      return;
    }

    settlement.status = SettlementStatus.COMPLETED;
    settlement.completedAt = new Date();
    if (event.partnerReference) {
      settlement.partnerReference = event.partnerReference;
    }
    await this.settlementsRepo.save(settlement);
    this.invalidateAnalyticsForMerchant(settlement.merchantId);

    await this.webhooks.dispatch(settlement.merchantId, 'settlement.completed', {
      settlementId: settlement.id,
    });
  }

  /**
   * Builds a CSV export for a merchant. The CSV is returned inline and also
   * cached behind a short lived token so it can be downloaded later.
   */
  async requestMerchantCsvExport(
    merchantId: string,
    from?: string,
    to?: string,
    _baseUrl?: string,
  ): Promise<{ csv: string; token?: string; fileName?: string }> {
    const csv = await this.exportCsvForMerchant(merchantId);
    const token = randomUUID();
    const fileName = `settlements-${merchantId}-${Date.now()}.csv`;

    this.csvExports.set(token, {
      fileName,
      fileData: csv,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    return { csv, token, fileName };
  }

  /** Resolves a previously generated CSV export by token. */
  async getCsvExportByToken(
    token: string,
  ): Promise<{ fileName: string; fileData: string }> {
    const record = this.csvExports.get(token);
    if (!record || record.expiresAt < Date.now()) {
      this.csvExports.delete(token);
      throw new NotFoundException('Export not found or expired');
    }
    return { fileName: record.fileName, fileData: record.fileData };
  }

  /** Builds a minimal PDF receipt for a settlement. */
  async getReceiptPdf(merchantId: string, settlementId: string): Promise<Buffer> {
    const settlement = await this.findOneForMerchant(merchantId, settlementId);
    return this.buildReceiptPdf(settlement);
  }

  /** Minimal single-page PDF writer — enough for a printable receipt. */
  private buildReceiptPdf(settlement: Settlement): Buffer {
    const lines = [
      'DupDub Settlement Receipt',
      `Settlement: ${settlement.id}`,
      `Status: ${settlement.status}`,
      `Gross amount: USD ${settlement.totalAmountUsd}`,
      `Fee: USD ${settlement.feeAmountUsd}`,
      `Net amount: USD ${settlement.netAmountUsd}`,
      `Created: ${settlement.createdAt?.toISOString() ?? ''}`,
    ];

    const escape = (value: string) => value.replace(/([\\()])/g, '\\$1');
    const content = lines
      .map(
        (line, index) =>
          `BT /F1 ${index === 0 ? 16 : 11} Tf 40 ${740 - index * 20} Td (${escape(line)}) Tj ET`,
      )
      .join('\n');

    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    ];

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, 'utf8');
  }

  async findForAdmin(query: AdminSettlementsQueryDto): Promise<PaginatedResponseDto<Settlement>> {
    const { page = 1, limit = 20, status, merchantId, startDate, endDate } = query;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (merchantId) where.merchantId = merchantId;
    if (startDate && endDate) {
      where.createdAt = Between(new Date(startDate), new Date(endDate));
    }

    const [items, total] = await this.settlementsRepo.findAndCount({
      where,
      relations: ['merchant', 'payments'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return PaginatedResponseDto.of(items, total, page, limit);
  }

  /** Paginated settlement list for the admin API (#445). */
  async findAllAdmin(query: AdminSettlementsQueryDto): Promise<PaginatedResponseDto<Settlement>> {
    return this.findForAdmin(query);
  }

  /**
   * Re-enqueues a failed settlement for processing (#445). Settlements that
   * are not failed cannot be retried.
   */
  async retrySettlement(
    settlementId: string,
  ): Promise<{ success: boolean; message: string; settlement: Settlement }> {
    const settlement = await this.settlementsRepo.findOne({ where: { id: settlementId } });
    if (!settlement) {
      throw new SettlementNotFoundException(settlementId);
    }

    if (settlement.status !== SettlementStatus.FAILED) {
      throw new SettlementNotRetryableException(settlement.status);
    }

    settlement.status = SettlementStatus.PENDING;
    settlement.failureReason = null as unknown as string;
    const saved = await this.settlementsRepo.save(settlement);

    await this.enqueueSettlement(saved.id);

    return {
      success: true,
      message: `Settlement ${settlementId} re-enqueued for processing.`,
      settlement: saved,
    };
  }

  async handlePartnerCallback(payload: PartnerCallbackPayload): Promise<void> {
    const settlement = await this.settlementsRepo.findOne({ where: { id: payload.reference } });
    if (!settlement) {
      this.logger.warn(`Received partner callback for unknown settlement ${payload.reference}`);
      return;
    }

    if (payload.status === 'success') {
      settlement.status = SettlementStatus.COMPLETED;
      settlement.completedAt = new Date();
    } else {
      settlement.status = SettlementStatus.FAILED;
      settlement.failureReason = payload.failureReason ?? 'Partner reported failure';
    }

    await this.settlementsRepo.save(settlement);
    this.invalidateAnalyticsForMerchant(settlement.merchantId);

    await this.webhooks.dispatch(settlement.merchantId, `settlement.${payload.status}`, {
      settlementId: settlement.id,
    });

    const feeBreakdown = this.toFeeBreakdown(settlement.merchantId, settlement);
    let recipient: string | null = null;
    try {
      const merchant = await this.merchantsService.findOne(settlement.merchantId);
      recipient = merchant?.email ?? null;
    } catch {
      recipient = null;
    }
    let emailEnabled = true;
    try {
      emailEnabled = await this.notificationPrefs.isEnabled(
        settlement.merchantId,
        NotificationChannel.EMAIL,
        NotificationEventType.SETTLEMENT_FAILED,
      );
    } catch {
      emailEnabled = true;
    }

    if (recipient && emailEnabled) {
      await this.emailService.sendSettlementStatusEmail(
        recipient,
        settlement,
        feeBreakdown as unknown as Record<string, unknown>,
      );
    }
  }
}
