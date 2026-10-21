import { Entity, PrimaryGeneratedColumn, Column, Unique, Index } from 'typeorm';

export enum MemberRole { OWNER = 'OWNER', DEVELOPER = 'DEVELOPER', VIEWER = 'VIEWER' }

@Entity('merchant_members')
@Index('merchant_members_key', ['apiKeyHash'], { unique: true, where: '"apiKeyHash" IS NOT NULL' })
@Unique(['merchantId', 'email'])
export class MerchantMember {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') merchantId: string;
  @Column() email: string;
  @Column({ type: 'enum', enum: MemberRole, enumName: 'merchant_member_role' }) role: MemberRole;
  @Column({ nullable: true, select: false }) apiKeyHash: string;
}
