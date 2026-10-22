import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
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
