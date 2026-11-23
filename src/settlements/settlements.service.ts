import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Raw, Repository } from 'typeorm';
import axios from 'axios';
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

interface SettlementDecisionResult {
  success: boolean;
  settlement: Settlement;
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
  ) {
    this.settlementsRepo = settlementsRepo as Repository<Settlement>;
    this.paymentsRepo = paymentsRepo as Repository<Payment>;
    this.auditLogRepo = auditLogRepo as Repository<AuditLog>;
  }

  private readonly settlementsRepo: Repository<Settlement>;
  private readonly paymentsRepo: Repository<Payment>;
  private readonly auditLogRepo: Repository<AuditLog>;

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
