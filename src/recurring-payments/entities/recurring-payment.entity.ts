import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { numericColumnTransformer } from '../../database/numeric-column.transformer';

export enum RecurringPaymentStatus {
  ACTIVE = 'active',
  CANCELLED = 'cancelled',
}

@Entity('recurring_payments')
@Index(['status', 'nextChargeAt'])
export class RecurringPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Merchant)
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Index()
  @Column()
  merchantId: string;

  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numericColumnTransformer })
  amountUsd: string;

  @Column({ nullable: true })
  description: string;

  /** Days between charges. */
  @Column({ type: 'int' })
  intervalDays: number;

  @Column({ type: 'enum', enum: RecurringPaymentStatus, default: RecurringPaymentStatus.ACTIVE })
  status: RecurringPaymentStatus;

  /** When the next payment request is created. */
  @Column({ type: 'timestamp' })
  nextChargeAt: Date;

  /** The nextChargeAt value the merchant was last notified about. */
  @Column({ type: 'timestamp', nullable: true })
  notifiedForChargeAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
