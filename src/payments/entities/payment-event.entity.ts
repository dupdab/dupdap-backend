import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { PaymentStatus } from './payment.entity';

export enum PaymentEventType {
  CREATED = 'created',
  STATUS_CHANGED = 'status_changed',
  CONFIRMED = 'confirmed',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
}

@Entity('payment_events')
@Index(['paymentId', 'timestamp'])
export class PaymentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  paymentId: string;

  @Column({ type: 'enum', enum: PaymentEventType })
  eventType: PaymentEventType;

  @Column({ type: 'enum', enum: PaymentStatus, nullable: true })
  previousStatus: PaymentStatus | null;

  @Column({ type: 'enum', enum: PaymentStatus, nullable: true })
  newStatus: PaymentStatus | null;

  @Column({ nullable: true })
  actorId: string;

  @CreateDateColumn()
  timestamp: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;
}
