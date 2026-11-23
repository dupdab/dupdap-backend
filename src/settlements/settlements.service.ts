import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Settlement, SettlementStatus } from './entities/settlement.entity';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
import { Merchant } from '../merchants/entities/merchant.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EmailService } from '../email/email.service';
import { MerchantsService } from '../merchants/merchants.service';
import { NotificationPrefsService } from '../notifications/notification-prefs.service';
import { StellarService } from '../stellar/stellar.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CronJobService } from '../cron/cron-job.service';
import { RetryConfigService } from '../retry/retry-config.service';
import { FeeCalculationService } from './fee-calculation.service';

const SMALL_BATCH_THRESHOLD_USD = 10;
const BATCH_FEE_RATE = 0.015;

/**
 * Settlements at or above this USD amount require manual admin approval
 * before they are dispatched to the partner. Shared by every settlement
 * creation path so the threshold cannot drift between them.
 */
export const LARGE_SETTLEMENT_THRESHOLD = 10000;

interface SettlementDecisionResult {
  success: boolean;
  settlement: Settlement;
}

/** Timeout applied to the partner fiat transfer request (#827). */
export const PARTNER_TRANSFER_TIMEOUT_MS = 30_000;

/** Consecutive partner timeouts for one settlement before admins are alerted (#827). */
export const PARTNER_TIMEOUT_ALERT_THRESHOLD = 3;

/**
 * Retriable error thrown when the partner API does not answer within
 * PARTNER_TRANSFER_TIMEOUT_MS. Bull retries the job because the error is thrown.
 */
export class PartnerTransferTimeoutError extends Error {
  readonly isRetriable = true;

  constructor(
    readonly settlementId: string,
    readonly timeoutMs: number,
  ) {
    super(`Partner fiat transfer timed out after ${timeoutMs}ms`);
    this.name = 'PartnerTransferTimeoutError';
  }
}

const DEFAULT_SETTLEMENT_QUEUE_DEPTH_THRESHOLD = 50;

const settlementQueueDepth = new Gauge({
  name: 'settlement_queue_depth',
  help: 'Number of jobs waiting in the settlement Bull queue',
});

export interface PartnerCallbackPayload {
  reference: string;
  status: 'success' | 'failed';
  failureReason?: string;
  [key: string]: unknown;
}

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    settlementsRepo?: Repository<Settlement>,
    paymentsRepo?: Repository<Payment>,
    auditLogRepo?: Repository<AuditLog>,
    @InjectQueue('settlements') private readonly settlementQueue: Queue,
    private readonly config: ConfigService,
    private readonly webhooks: WebhooksService,
    private readonly adminAlerts: AdminAlertService,
    private readonly analytics: AnalyticsService,
    private readonly emailService: EmailService,
    private readonly merchantsService: MerchantsService,
    private readonly notificationPrefs: NotificationPrefsService,
    private readonly stellar: StellarService,
    private readonly cronJobService: CronJobService,
    private readonly retryConfig: RetryConfigService,
    @InjectDataSource() private readonly dataSource?: DataSource,
  ) {
    this.settlementsRepo = settlementsRepo as Repository<Settlement>;
    this.paymentsRepo = paymentsRepo as Repository<Payment>;
    this.auditLogRepo = auditLogRepo as Repository<AuditLog>;
  }

  private readonly settlementsRepo: Repository<Settlement>;
  private readonly paymentsRepo: Repository<Payment>;
  private readonly auditLogRepo: Repository<AuditLog>;
  private readonly logger = new Logger(SettlementsService.name);

  // ── Queue depth monitoring (#830) ──────────────────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async monitorQueueDepth(): Promise<void> {
    try {
      const depth = await this.settlementQueue.getWaitingCount();
      settlementQueueDepth.set(depth);

      const threshold = this.queueDepthThreshold();
      if (depth <= threshold) return;

      this.logger.warn(`Settlement queue depth ${depth} exceeds threshold ${threshold}`);
      await this.adminAlerts.raise({
        type: AdminAlertType.SETTLEMENT_FAILURE,
        dedupeKey: 'settlement_queue_depth',
        message: `Settlement queue depth is ${depth}, above the threshold of ${threshold}.`,
        metadata: { queue: 'settlements', depth, threshold },
        thresholdValue: depth,
      });
    } catch (error) {
      this.logger.error(
        `Failed to check settlement queue depth: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private queueDepthThreshold(): number {
    const configured = Number(this.config.get<string>('SETTLEMENT_QUEUE_DEPTH_THRESHOLD'));
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_SETTLEMENT_QUEUE_DEPTH_THRESHOLD;
  }

  private readonly fees = new FeeCalculationService();

  /**
   * Settles all confirmed, unsettled payments of a merchant in one batch.
   * The settlement insert and every payment update share one transaction,
   * so a mid-way failure can't leave payments without a settlementId.
   */
  async createBatchSettlement(merchantId: string): Promise<Settlement | null> {
    return this.settlementsRepo.manager.transaction(async (manager) => {
      const payments = await manager.find(Payment, {
        where: { merchantId, status: PaymentStatus.CONFIRMED, settlementId: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payments.length) return null;

      const total = payments.reduce((sum, p) => sum + Number(p.amountUsd), 0);
      const { feeUsd, netUsd } = await this.fees.calculateFee(merchantId, total);

      const settlement = await manager.save(
        manager.create(Settlement, {
          merchantId,
          totalAmountUsd: String(total),
          feeAmountUsd: String(feeUsd),
          netAmountUsd: String(netUsd),
        }),
      );

      await manager.update(
        Payment,
        payments.map((p) => p.id),
        { settlementId: settlement.id },
      );

      return settlement;
    });
  }

  // ── Settlement creation ────────────────────────────────────────────────────

  // Must be called with the transaction manager that is confirming the payment:
  // every write goes through `manager`, so the settlement and the payment status
  // commit or roll back together. Callers must dispatch webhooks after commit.
  async initiateSettlement(payment: Payment, manager: EntityManager): Promise<Settlement> {
    const merchant = await manager.findOneOrFail(Merchant, { where: { id: payment.merchantId } });

    const totalUsd = Number(payment.amountUsd);
    const feeUsd = totalUsd * Number(merchant.feeRate);

    const settlement = await manager.save(
      manager.create(Settlement, {
        merchantId: payment.merchantId,
        totalAmountUsd: totalUsd.toFixed(6),
        feeAmountUsd: feeUsd.toFixed(6),
        netAmountUsd: (totalUsd - feeUsd).toFixed(6),
        status: SettlementStatus.PENDING,
      }),
    );

    payment.status = PaymentStatus.SETTLING;
    payment.settlementId = settlement.id;
    await manager.save(payment);

    return settlement;
  }

  // ── Small-payment batching ─────────────────────────────────────────────────

  async batchSmallConfirmedPayments(): Promise<void> {
    // amountUsd is a decimal column; cast explicitly so the comparison is numeric, never textual.
    const payments = await this.paymentsRepo.find({
      where: {
        status: PaymentStatus.CONFIRMED,
        amountUsd: Raw((alias) => `CAST(${alias} AS numeric) < :threshold`, {
          threshold: SMALL_BATCH_THRESHOLD_USD,
        }),
      },
      order: { confirmedAt: 'ASC' },
    });

    const byMerchant = new Map<string, Payment[]>();
    for (const payment of payments) {
      const group = byMerchant.get(payment.merchantId) ?? [];
      group.push(payment);
      byMerchant.set(payment.merchantId, group);
    }

    for (const [merchantId, group] of byMerchant) {
      const total = group.reduce((sum, p) => sum + Number(p.amountUsd), 0);
      if (total < SMALL_BATCH_THRESHOLD_USD) continue;

      const fee = total * BATCH_FEE_RATE;
      const merchant = await this.merchantsService.findOne(merchantId);
      const settlement = await this.settlementsRepo.save(
        this.settlementsRepo.create({
          merchantId,
          totalAmountUsd: total.toFixed(6),
          feeAmountUsd: fee.toFixed(6),
          netAmountUsd: (total - fee).toFixed(6),
          fiatCurrency: merchant.settlementCurrency,
          status: SettlementStatus.PROCESSING,
          requiresApproval: false,
        }),
      );

      for (const payment of group) {
        payment.status = PaymentStatus.SETTLING;
        payment.settlementId = settlement.id;
        await this.paymentsRepo.save(payment);
      }

      await this.settlementQueue.add(
        'dispatch',
        { settlementId: settlement.id },
        { attempts: this.retryConfig.settlement.maxAttempts + 1 },
      );
    }
  }
  }

  // ── Settlement initiation (#820) ───────────────────────────────────────────

  /**
   * Creates the settlement and moves the payment to SETTLING atomically.
   * The webhook is dispatched only after the transaction has committed, so a
   * crash mid-operation can never leave partial writes or a phantom webhook.
   */
  async initiateSettlement(payment: Payment, manager?: EntityManager): Promise<Settlement | null> {
    if (manager) {
      const settlement = await this.createSettlementInTransaction(payment, manager);
      await this.dispatchSettlementInitiated(payment, settlement);
      return settlement;
    }

    const settlement = await this.runInTransaction((tx) =>
      this.createSettlementInTransaction(payment, tx),
    );

    // Only reached once the transaction has committed.
    await this.dispatchSettlementInitiated(payment, settlement);

    return settlement;
  }

  private async dispatchSettlementInitiated(
    payment: Payment,
    settlement: Settlement,
  ): Promise<void> {
    await this.webhooks.dispatch(payment.merchantId, 'settlement.initiated', {
      settlementId: settlement.id,
      paymentId: payment.id,
      status: settlement.status,
    });
  }

  private async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!this.dataSource) {
      throw new Error('DataSource is required to initiate a settlement');
    }
    return this.dataSource.transaction(work);
  }

  private async createSettlementInTransaction(
    payment: Payment,
    manager: EntityManager,
  ): Promise<Settlement> {
    const settlementsRepo = manager.getRepository(Settlement);
    const paymentsRepo = manager.getRepository(Payment);

    const settlement = settlementsRepo.create({
      merchantId: payment.merchantId,
      totalAmountUsd: payment.amountUsd,
      feeAmountUsd: '0.000000',
      netAmountUsd: payment.amountUsd,
      status: SettlementStatus.PENDING,
    });

    const saved = await settlementsRepo.save(settlement);

    payment.status = PaymentStatus.SETTLING;
    payment.settlement = saved;
    await paymentsRepo.save(payment);

    return saved;
  }

  /** Consecutive partner timeouts per settlement id (#827). */
  private readonly partnerTimeoutCounts = new Map<string, number>();

  // ── Partner fiat transfer (#827) ───────────────────────────────────────────

  async executeFiatTransfer(settlement: Settlement): Promise<void> {
    const partnerUrl = this.config.get<string>('SETTLEMENT_PARTNER_URL');
    const apiKey = this.config.get<string>('SETTLEMENT_PARTNER_API_KEY');

    try {
      const response = await axios.post(
        partnerUrl,
        {
          reference: settlement.id,
          amount: settlement.netAmountUsd,
          currency: settlement.fiatCurrency,
        },
        {
          timeout: PARTNER_TRANSFER_TIMEOUT_MS,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        },
      );

      this.partnerTimeoutCounts.delete(settlement.id);
      settlement.partnerReference = response?.data?.reference;
      settlement.status = SettlementStatus.COMPLETED;
      await this.settlementsRepo.save(settlement);
    } catch (error) {
      if (this.isTimeoutError(error)) {
        await this.handlePartnerTimeout(settlement);
        throw new PartnerTransferTimeoutError(settlement.id, PARTNER_TRANSFER_TIMEOUT_MS);
      }

      settlement.status = SettlementStatus.FAILED;
      settlement.failureReason = (error as Error)?.message ?? 'Partner transfer failed';
      await this.settlementsRepo.save(settlement);
      throw error;
    }
  }

  private isTimeoutError(error: unknown): boolean {
    const err = error as { code?: string; message?: string } | undefined;
    return (
      err?.code === 'ECONNABORTED' ||
      err?.code === 'ETIMEDOUT' ||
      /timeout/i.test(err?.message ?? '')
    );
  }

  private async handlePartnerTimeout(settlement: Settlement): Promise<void> {
    const consecutive = (this.partnerTimeoutCounts.get(settlement.id) ?? 0) + 1;
    this.partnerTimeoutCounts.set(settlement.id, consecutive);

    if (consecutive < PARTNER_TIMEOUT_ALERT_THRESHOLD) return;

    await this.adminAlerts.raise({
      type: AdminAlertType.SETTLEMENT_FAILURE,
      dedupeKey: `settlement:${settlement.id}`,
      message: `Partner fiat transfer timed out ${consecutive} consecutive times for settlement ${settlement.id}`,
      metadata: {
        settlementId: settlement.id,
        consecutiveTimeouts: consecutive,
        timeoutMs: PARTNER_TRANSFER_TIMEOUT_MS,
      },
      thresholdValue: consecutive,
    });
  }

  // ── Admin approval workflow (#445) ─────────────────────────────────────────

  async approveSettlement(settlementId: string, adminId: string): Promise<SettlementDecisionResult> {
    const settlement = await this.settlementsRepo.findOne({
      where: { id: settlementId },
      relations: ['payments', 'merchant'],
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== SettlementStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only settlements pending approval can be approved');
    }
    if (!settlement.requiresApproval) {
      throw new BadRequestException('Settlement does not require manual approval');
    }

    settlement.status = SettlementStatus.PROCESSING;
    settlement.approvedBy = adminId;
    settlement.approvedAt = new Date();
    await this.settlementsRepo.save(settlement);

    for (const payment of settlement.payments ?? []) {
      payment.status = PaymentStatus.SETTLING;
      await this.paymentsRepo.save(payment);
    }

    await this.writeAuditLog({
      actor: adminId,
      action: 'SETTLEMENT_APPROVED',
      resourceType: 'settlement',
      resourceId: settlement.id,
      details: { status: settlement.status, requiresApproval: settlement.requiresApproval },
    });

    const payments = await this.paymentsRepo.find({ where: { settlementId: settlement.id } });
    for (const payment of payments) {
      payment.status = PaymentStatus.SETTLING;
      await this.paymentsRepo.save(payment);
      await this.webhooks.dispatch(settlement.merchantId, 'payment.settling', {
        paymentId: payment.id,
        settlementId: settlement.id,
        amount: Number(payment.amountUsd),
      });
    }

    await this.settlementQueue.add(
      'dispatch',
      { settlementId },
      { attempts: this.retryConfig.settlement.maxAttempts + 1 },
    );

    for (const payment of settlement.payments ?? []) {
      await this.webhooks.dispatch(payment.merchantId, 'payment.settling', {
        paymentId: payment.id,
        settlementId: settlement.id,
        amount: payment.amountUsd,
      });
    }

    await this.notifySettlementDecision(settlement, 'approved', adminId);

    return { success: true, settlement };
  }

  async rejectSettlement(settlementId: string, adminId: string): Promise<SettlementDecisionResult> {
    const settlement = await this.settlementsRepo.findOne({
      where: { id: settlementId },
      relations: ['payments', 'merchant'],
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== SettlementStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only settlements pending approval can be rejected');
    }
    if (!settlement.requiresApproval) {
      throw new BadRequestException('Settlement does not require manual approval');
    }

    settlement.status = SettlementStatus.FAILED;
    settlement.approvedBy = adminId;
    settlement.approvedAt = new Date();
    settlement.failureReason = 'Rejected by administrator';
    await this.settlementsRepo.save(settlement);

    await this.writeAuditLog({
      actor: adminId,
      action: 'SETTLEMENT_REJECTED',
      resourceType: 'settlement',
      resourceId: settlement.id,
      details: { status: settlement.status, failureReason: settlement.failureReason },
    });

    // Release linked payments back to CONFIRMED so they can be reprocessed in a new settlement.
    const payments = settlement.payments ?? [];
    for (const payment of payments) {
      payment.status = PaymentStatus.CONFIRMED;
      payment.settlementId = null;
      await this.paymentsRepo.save(payment);

      await this.webhooks.dispatch(settlement.merchantId, 'payment.settlement_rejected', {
        paymentId: payment.id,
        settlementId: settlement.id,
        reason: settlement.failureReason,
      });
    }

    for (const payment of payments) {
      await this.webhooks.dispatch(payment.merchantId, 'payment.settlement_rejected', {
        paymentId: payment.id,
        reference: payment.reference,
        settlementId: settlement.id,
      });
    }

    await this.notifySettlementDecision(settlement, 'rejected', adminId);

    return { success: true, settlement };
  }

  async findAllAdmin(query: {
    page: number;
    limit: number;
    status?: string;
    merchantId?: string;
    requiresApproval?: boolean;
    dateField?: 'created' | 'completed';
    from?: string;
    to?: string;
  }) {
    const qb = this.settlementsRepo
      .createQueryBuilder('settlement')
      .leftJoinAndSelect('settlement.merchant', 'merchant')
      .leftJoinAndSelect('settlement.payments', 'payments')
      .orderBy('settlement.createdAt', 'DESC');

    if (query.status) qb.andWhere('settlement.status = :status', { status: query.status });

    const dateColumn =
      query.dateField === 'completed' ? 'settlement.completedAt' : 'settlement.createdAt';
    if (query.dateFrom) {
      qb.andWhere(`${dateColumn} >= :dateFrom`, { dateFrom: new Date(query.dateFrom) });
    }
    if (query.dateTo) {
      qb.andWhere(`${dateColumn} <= :dateTo`, { dateTo: new Date(query.dateTo) });
    }
    if (query.merchantId)
      qb.andWhere('settlement.merchantId = :merchantId', { merchantId: query.merchantId });
    if (query.requiresApproval !== undefined) {
      qb.andWhere('settlement.requiresApproval = :requiresApproval', {
        requiresApproval: query.requiresApproval,
      });
    }

    if (query.from || query.to) {
      const dateColumn =
        query.dateField === 'completed' ? 'settlement.completedAt' : 'settlement.createdAt';
      if (query.from) qb.andWhere(`${dateColumn} >= :from`, { from: new Date(query.from) });
      if (query.to) qb.andWhere(`${dateColumn} <= :to`, { to: new Date(query.to) });
    }

    const [items, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      data: items,
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    };
  }

  // ── Small payment batching (#831) ──────────────────────────────────────────

  /** Payments below this USD amount are batched instead of settled immediately. */
  private static readonly SMALL_PAYMENT_THRESHOLD_USD = 10;

  /**
   * Flushes confirmed small payments per merchant once their combined value
   * reaches the small-payment threshold.
   *
   * `payments.amountUsd` is a `decimal` column mapped to a string, so the
   * comparison is done numerically in SQL (`amountUsd::numeric < :threshold`)
   * rather than with TypeORM `LessThan()` on a number, which would compare
   * against a string literal and mis-order values such as '9.99' vs '10.00'.
   */
  async batchSmallConfirmedPayments(): Promise<void> {
    const threshold = SettlementsService.SMALL_PAYMENT_THRESHOLD_USD;

    const smallPayments = await this.paymentsRepo
      .createQueryBuilder('payment')
      .where('payment.status = :status', { status: PaymentStatus.CONFIRMED })
      .andWhere('payment.settlementId IS NULL')
      .andWhere('payment.amountUsd::numeric < :threshold', { threshold })
      .orderBy('payment.confirmedAt', 'ASC')
      .getMany();

    if (!smallPayments.length) return;

    const byMerchant = new Map<string, Payment[]>();
    for (const payment of smallPayments) {
      const group = byMerchant.get(payment.merchantId) ?? [];
      group.push(payment);
      byMerchant.set(payment.merchantId, group);
    }

    for (const [merchantId, payments] of byMerchant) {
      const total = payments.reduce((sum, p) => sum + Number(p.amountUsd), 0);
      if (total < threshold) continue;

      const totalAmountUsd = total.toFixed(6);
      const feeAmountUsd = (total * 0.015).toFixed(6);
      const netAmountUsd = (total - Number(feeAmountUsd)).toFixed(6);

      const settlement = this.settlementsRepo.create({
        merchantId,
        totalAmountUsd,
        feeAmountUsd,
        netAmountUsd,
        fiatCurrency: 'NGN',
        status: SettlementStatus.PROCESSING,
        requiresApproval: false,
      });
      await this.settlementsRepo.save(settlement);

      for (const payment of payments) {
        payment.status = PaymentStatus.SETTLING;
        payment.settlementId = settlement.id;
        await this.paymentsRepo.save(payment);
      }

      await this.settlementQueue.add(
        'dispatch',
        { settlementId: settlement.id },
        { attempts: this.retryConfig.settlement.maxAttempts + 1 },
      );
    }
  }

  // ── Fiat transfer ──────────────────────────────────────────────────────────

  private static readonly PARTNER_TIMEOUT_MS = 30_000;
  private static readonly TIMEOUT_ALERT_THRESHOLD = 3;
  // shortcut: in-memory per-process counter, resets on restart; persist if workers are scaled out.
  private readonly consecutiveTimeouts = new Map<string, number>();

  async executeFiatTransfer(settlement: Settlement): Promise<void> {
    const payments = settlement.payments ?? [];
    try {
      const { data } = await axios.post(
        `${this.config.get<string>('PARTNER_API_URL')}/transfers`,
        {
          reference: settlement.id,
          amount: settlement.netAmountUsd,
          currency: settlement.fiatCurrency,
        },
        {
          headers: { Authorization: `Bearer ${this.config.get<string>('PARTNER_API_KEY')}` },
          timeout: SettlementsService.PARTNER_TIMEOUT_MS,
        },
      );

      this.consecutiveTimeouts.delete(settlement.id);
      settlement.partnerReference = data?.reference;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (axios.isAxiosError?.(err) && err.code === 'ECONNABORTED') {
        const count = (this.consecutiveTimeouts.get(settlement.id) ?? 0) + 1;
        this.consecutiveTimeouts.set(settlement.id, count);
        if (count >= SettlementsService.TIMEOUT_ALERT_THRESHOLD) {
          await this.adminAlerts.raise({
            type: AdminAlertType.SETTLEMENT_FAILURE,
            dedupeKey: `settlement-timeout:${settlement.id}`,
            message: `Partner API timed out ${count} consecutive times for settlement ${settlement.id}`,
            metadata: { settlementId: settlement.id, consecutiveTimeouts: count },
            thresholdValue: count,
          });
        }
        // Rethrow so Bull retries; settlement stays PROCESSING.
        throw new Error(`Partner API timeout for settlement ${settlement.id}: ${message}`);
      }

      this.consecutiveTimeouts.delete(settlement.id);
      settlement.status = SettlementStatus.FAILED;
      settlement.failureReason = message;
      await this.settlementsRepo.save(settlement);
      for (const payment of payments) {
        payment.status = PaymentStatus.FAILED;
        await this.paymentsRepo.save(payment);
      }
      await this.adminAlerts.raise({
        type: AdminAlertType.SETTLEMENT_FAILURE,
        dedupeKey: `settlement:${settlement.id}`,
        message: `Settlement ${settlement.id} failed: ${message}`,
        metadata: { settlementId: settlement.id },
        thresholdValue: 1,
      });
    }
  }

  // ── Partner callback (#825) ────────────────────────────────────────────────

  async handlePartnerCallback(
    payload: PartnerCallbackPayload,
    signature?: string,
    rawBody?: Buffer | string,
  ): Promise<{ success: boolean }> {
    this.verifyPartnerSignature(signature, rawBody, payload);

    const settlement = await this.settlementsRepo.findOne({
      where: { id: payload.reference },
      relations: ['payments'],
    });
    if (!settlement) {
      this.logger.warn('Partner callback for unknown settlement', { reference: payload.reference });
      return;
    }
    if (
      settlement.status === SettlementStatus.COMPLETED ||
      settlement.status === SettlementStatus.FAILED
    ) {
      this.logger.warn('Duplicate partner callback ignored', {
        settlementId: settlement.id,
        status: settlement.status,
      });
      return;
    }

    if (payload.status === 'success') {
      settlement.status = SettlementStatus.COMPLETED;
      settlement.completedAt = new Date();
      await this.settlementsRepo.save(settlement);

      for (const payment of settlement.payments ?? []) {
        await this.stellar.invokeContract('settle', [payment.id, settlement.id]);
        payment.status = PaymentStatus.SETTLED;
        await this.paymentsRepo.save(payment);
        await this.webhooks.dispatch(settlement.merchantId, 'payment.settled', {
          paymentId: payment.id,
          settlementId: settlement.id,
          amount: Number(payment.amountUsd),
        });
      }

      this.analytics.clearCacheForMerchant(settlement.merchantId);
    } else {
      settlement.status = SettlementStatus.FAILED;
      settlement.failureReason = `Partner reported status: ${payload.status}`;
      await this.settlementsRepo.save(settlement);

      for (const payment of settlement.payments ?? []) {
        payment.status = PaymentStatus.FAILED;
        await this.paymentsRepo.save(payment);
      }

      await this.adminAlerts.raise({
        type: AdminAlertType.SETTLEMENT_FAILURE,
        message: `Settlement ${settlement.id} failed: ${payload.status}`,
        dedupeKey: `settlement:${settlement.id}`,
      });
    }

    return { success: true };
  }

  private verifyPartnerSignature(
    signature: string | undefined,
    rawBody: Buffer | string | undefined,
    payload: PartnerCallbackPayload,
  ): void {
    if (!signature) {
      this.logger.warn('[SECURITY] Partner callback missing X-Partner-Signature header', {
        reference: payload?.reference,
      });
      throw new UnauthorizedException('Missing signature');
    }

    const secret = this.config.get<string>('PARTNER_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('[SECURITY] PARTNER_WEBHOOK_SECRET is not configured');
      throw new UnauthorizedException('Signature verification unavailable');
    }

    const body = rawBody ?? Buffer.from(JSON.stringify(payload ?? {}));
    const expected = createHmac('sha256', secret).update(body).digest('hex');

    let valid = false;
    try {
      const expectedBuf = Buffer.from(expected, 'hex');
      const receivedBuf = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
      valid =
        expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
      valid = false;
    }

    if (!valid) {
      this.logger.warn('[SECURITY] Partner callback signature mismatch — possible forgery', {
        reference: payload?.reference,
      });
      throw new UnauthorizedException('Invalid signature');
    }
  }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async writeAuditLog(entry: {
    actor?: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    details?: Record<string, any> | null;
  }): Promise<void> {
    if (!this.auditLogRepo) return;
    const log = this.auditLogRepo.create({
      actor: entry.actor ?? 'system',
      action: entry.action,
      resource: entry.resourceId
        ? `${entry.resourceType}:${entry.resourceId}`
        : entry.resourceType,
      before: null,
      after: entry.details ?? null,
      ip: undefined,
    });
    await this.auditLogRepo.save(log);
  }

  /**
   * Sends the settlement status email to the merchant (#832).
   * Used by the non-callback completion path so it matches the partner
   * callback path. Never throws: email failures must not fail a settlement.
   */
  private async sendSettlementCompletionEmail(settlement: Settlement): Promise<void> {
    try {
      const merchant =
        settlement.merchant ??
        (settlement.merchantId
          ? await this.merchantsService.findOne(settlement.merchantId)
          : undefined);
      if (!merchant?.email) return;

      await this.emailService.sendSettlementStatusEmail(
        merchant.email,
        {
          id: settlement.id,
          status: settlement.status,
          totalAmountUsd: settlement.totalAmountUsd,
          netAmountUsd: settlement.netAmountUsd,
        },
        {
          totalAmountUsd: settlement.totalAmountUsd,
          feeAmountUsd: settlement.feeAmountUsd,
          netAmountUsd: settlement.netAmountUsd,
        },
      );
    } catch {
      // Swallow: notification is best-effort and must not break settlement.
    }
  }

  private async executeFiatTransfer(settlement: Settlement): Promise<void> {
    const partnerUrl = this.config.get<string>('SETTLEMENT_PARTNER_URL');
    const partnerApiKey = this.config.get<string>('SETTLEMENT_PARTNER_API_KEY');
    if (!partnerUrl || !partnerApiKey) {
      throw new Error('Settlement partner is not configured');
    }

    await axios.post(
      `${partnerUrl}/transfers`,
      {
        reference: settlement.id,
        amount: settlement.netAmountUsd,
        currency: settlement.fiatCurrency,
        merchantId: settlement.merchantId,
      },
      { headers: { Authorization: `Bearer ${partnerApiKey}`, 'Content-Type': 'application/json' } },
    );
  }

  async processSettlement(settlementId: string): Promise<void> {
    const settlement = await this.settlementsRepo.findOne({ where: { id: settlementId } });
    if (!settlement) throw new NotFoundException(`Settlement ${settlementId} not found`);
    if (settlement.status !== SettlementStatus.PROCESSING) {
      this.logger.warn(`Settlement ${settlementId} is not in PROCESSING state; skipping`);
      return;
    }

    try {
      await this.executeFiatTransfer(settlement);
      settlement.status = SettlementStatus.COMPLETED;
      settlement.completedAt = new Date();
      await this.settlementsRepo.save(settlement);
      await this.webhooks.dispatch(settlement.merchantId, 'settlement.completed', {
        settlementId: settlement.id,
      });
    } catch (error) {
      settlement.status = SettlementStatus.FAILED;
      settlement.failureReason = (error as Error).message;
      await this.settlementsRepo.save(settlement);
      throw error;
    }

    // Outside the try: an email failure must not mark a completed transfer as FAILED.
    const merchant = await this.merchantsService.findOne(settlement.merchantId).catch(() => null);
    if (merchant?.email) {
      await this.emailService.sendSettlementStatusEmail(merchant.email, settlement);
    }
  }
    }
  }

  private async notifySettlementDecision(
    settlement: Settlement,
    decision: 'approved' | 'rejected',
    adminId: string,
  ): Promise<void> {
    const merchant = settlement.merchant;
    if (!merchant) return;

    const prefs = await this.notificationPrefs.getPrefs(merchant.id);
    const emailEnabled =
      prefs.preferences.find(
        (p) => p.channel === 'EMAIL' && p.eventType === 'SETTLEMENT_DECISION',
      )?.enabled ?? true;

    if (!emailEnabled || !merchant.email) return;

    await this.emailService.queue(
      merchant.email,
      'settlement-decision',
      {
        subject: `Settlement ${settlement.id} ${decision}`,
        settlementId: settlement.id,
        decision,
        totalAmountUsd: settlement.totalAmountUsd,
        netAmountUsd: settlement.netAmountUsd,
        approvedBy: adminId,
        reason: decision === 'rejected' ? settlement.failureReason : undefined,
      },
      merchant.id,
    );
  }
}
