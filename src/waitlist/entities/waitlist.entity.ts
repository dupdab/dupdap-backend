import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('waitlist')
export class WaitlistEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ unique: true, nullable: true })
  username: string;

  @Column({ nullable: true })
  businessName: string;

  @Column({ nullable: true })
  country: string;

  @Column({ default: false })
  notified: boolean;

  @Column({ default: false })
  approved: boolean;

  @Column({ default: false })
  unsubscribed: boolean;

  @Column({ default: 0 })
  referralCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
