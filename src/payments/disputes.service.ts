import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { DisputeStatus, PaymentDispute } from './entities/payment-dispute.entity';
import { Cron } from '@nestjs/schedule';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { SettlementsService } from '../settlements/settlements.service';

@Injectable()
export class DisputesService {
  constructor(@InjectRepository(PaymentDispute) private readonly disputes: Repository<PaymentDispute>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly adminAlerts: AdminAlertService,
    private readonly settlements: SettlementsService) {}

  async raise(paymentId: string, merchantId: string | undefined, customerEmail: string | undefined, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('A dispute reason is required');
    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!merchantId && (!customerEmail || payment.customerEmail?.toLowerCase() !== customerEmail.toLowerCase())) throw new NotFoundException('Payment not found');
    if (merchantId && payment.merchantId !== merchantId) throw new NotFoundException('Payment not found');
    const duplicate = await this.disputes.findOne({ where: { paymentId, status: DisputeStatus.OPEN } });
    if (duplicate) throw new BadRequestException('An open dispute already exists for this payment');
    const slaHours = Number(process.env.PAYMENT_DISPUTE_SLA_HOURS ?? 48);
    return this.disputes.save(this.disputes.create({ paymentId, merchantId: payment.merchantId, raisedBy: merchantId ?? customerEmail!, reason,
      slaDeadline: new Date(Date.now() + slaHours * 3600000), status: DisputeStatus.OPEN }));
  }
  queue() { return this.disputes.find({ where: [{ status: DisputeStatus.OPEN }, { status: DisputeStatus.UNDER_REVIEW }, { status: DisputeStatus.ESCALATED }], order: { slaDeadline: 'ASC' } }); }
  async review(id: string, adminId: string, status: DisputeStatus, resolution?: string) {
    const dispute = await this.disputes.findOne({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    dispute.status = status; dispute.reviewedBy = adminId; dispute.resolution = resolution ?? null;
    if (status === DisputeStatus.RESOLVED) dispute.resolvedAt = new Date();
    const saved = await this.disputes.save(dispute);
    if (status === DisputeStatus.RESOLVED) await this.settlements.resumeAfterDisputeResolution(dispute.paymentId);
    return saved;
  }
  @Cron('0 */15 * * * *')
  async escalateOverdue() {
    const overdue = await this.disputes.find({ where: { status: DisputeStatus.OPEN, slaDeadline: LessThanOrEqual(new Date()) } });
    for (const dispute of overdue) {
      dispute.status = DisputeStatus.ESCALATED; await this.disputes.save(dispute);
      await this.adminAlerts.raise({ type: AdminAlertType.TRANSACTION_LIMIT, dedupeKey: `payment-dispute:${dispute.id}`,
        message: `Payment dispute ${dispute.id} exceeded its review SLA`, metadata: { disputeId: dispute.id, paymentId: dispute.paymentId }, thresholdValue: 1 });
    }
    return overdue.length;
  }
  async hasActiveDispute(paymentIds: string[]): Promise<boolean> {
    if (!paymentIds.length) return false;
    return (await this.disputes.createQueryBuilder('dispute').where('dispute.paymentId IN (:...paymentIds)', { paymentIds })
      .andWhere('dispute.status IN (:...statuses)', { statuses: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW, DisputeStatus.ESCALATED] }).getCount()) > 0;
  }
}
