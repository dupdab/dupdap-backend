import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Gauge } from 'prom-client';
import { Repository } from 'typeorm';
import { Settlement, SettlementStatus } from './entities/settlement.entity';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
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

interface SettlementDecisionResult {
  success: boolean;
  settlement: Settlement;
}

const DEFAULT_SETTLEMENT_QUEUE_DEPTH_THRESHOLD = 50;

const settlementQueueDepth = new Gauge({
  name: 'settlement_queue_depth',
  help: 'Number of jobs waiting in the settlement Bull queue',
});

@Injectable()
export class SettlementsService {
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

    await this.writeAuditLog({
      actor: adminId,
      action: 'SETTLEMENT_APPROVED',
      resourceType: 'settlement',
      resourceId: settlement.id,
      details: { status: settlement.status, requiresApproval: settlement.requiresApproval },
    });

    await this.settlementQueue.add(
      'dispatch',
      { settlementId },
      { attempts: this.retryConfig.settlement.maxAttempts + 1 },
    );

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

    for (const payment of settlement.payments ?? []) {
      payment.status = PaymentStatus.FAILED;
      await this.paymentsRepo.save(payment);
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
  }) {
    const qb = this.settlementsRepo
      .createQueryBuilder('settlement')
      .leftJoinAndSelect('settlement.merchant', 'merchant')
      .leftJoinAndSelect('settlement.payments', 'payments')
      .orderBy('settlement.createdAt', 'DESC');

    if (query.status) qb.andWhere('settlement.status = :status', { status: query.status });
    if (query.merchantId)
      qb.andWhere('settlement.merchantId = :merchantId', { merchantId: query.merchantId });
    if (query.requiresApproval !== undefined) {
      qb.andWhere('settlement.requiresApproval = :requiresApproval', {
        requiresApproval: query.requiresApproval,
      });
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
