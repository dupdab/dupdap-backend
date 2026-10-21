import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum DisputeStatus { OPEN = 'OPEN', UNDER_REVIEW = 'UNDER_REVIEW', RESOLVED = 'RESOLVED', ESCALATED = 'ESCALATED' }

@Entity('payment_disputes')
@Index('IDX_payment_disputes_payment_status', ['paymentId', 'status'])
export class PaymentDispute {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() paymentId: string;
  @Column() merchantId: string;
  @Column() raisedBy: string;
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'enum', enum: DisputeStatus, default: DisputeStatus.OPEN }) status: DisputeStatus;
  @Column({ type: 'timestamptz' }) slaDeadline: Date;
  @Column({ type: 'text', nullable: true }) resolution: string | null;
  @Column({ nullable: true }) reviewedBy: string | null;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
