import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { encryptedColumnTransformer } from '../../security/encrypted-column.transformer';

@Entity('webhooks')
@Index('IDX_WEBHOOK_MERCHANT_ID', ['merchantId'])
@Index('IDX_WEBHOOK_MERCHANT_ACTIVE', ['merchantId', 'isActive'])
export class Webhook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Merchant, (merchant) => merchant.webhooks)
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Column()
  merchantId: string;

  @Column()
  url: string;

  @Column({ default: 'v1' })
  version: string;

  @Column({ type: 'simple-array' })
  events: string[];

  @Exclude()
  @Column({
    nullable: true,
    transformer: encryptedColumnTransformer('webhooks.secret'),
  })
  secret: string;

  /**
   * Previous secret kept valid during the rotation grace period (#907).
   * Signature verification accepts this secret until `previousSecretExpiresAt`.
   */
  @Exclude()
  @Column({
    nullable: true,
    transformer: encryptedColumnTransformer('webhooks.previousSecret'),
  })
  previousSecret: string | null;

  /** When the previous secret stops being accepted; null when no rotation is pending. */
  @Column({ type: 'timestamptz', nullable: true })
  previousSecretExpiresAt: Date | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  failureCount: number;

  @Column({ nullable: true })
  lastDeliveredAt: Date;

  /** While in the future the circuit is open and deliveries are skipped (#457). */
  @Column({ type: 'timestamptz', nullable: true })
  circuitOpenUntil: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
