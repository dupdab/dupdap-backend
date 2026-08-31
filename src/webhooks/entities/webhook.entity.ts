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

  @Column({ type: 'simple-array' })
  events: string[];

  @Exclude()
  @Column({
    nullable: true,
    transformer: encryptedColumnTransformer('webhooks.secret'),
  })
  secret: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  failureCount: number;

  @Column({ nullable: true })
  lastDeliveredAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
