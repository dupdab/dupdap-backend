import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('settlement_exports')
export class SettlementExport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  merchantId: string;

  @Column()
  recipientEmail: string;

  @Column()
  deliveryBaseUrl: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  dateFrom: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  dateTo: string | null;

  @Column({ default: 'queued' })
  status: string;

  @Column({ nullable: true })
  fileName: string | null;

  @Column({ type: 'bytea', nullable: true })
  fileData: Buffer | null;

  @Column({ nullable: true, unique: true })
  downloadToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;
}
