import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('merchant_fee_tiers')
@Index(['merchantId', 'minimumVolumeUsd'], { unique: true })
export class MerchantFeeTier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  merchantId: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  minimumVolumeUsd: string;

  @Column({ type: 'decimal', precision: 7, scale: 6 })
  feeRate: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
