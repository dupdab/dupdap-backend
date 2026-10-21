import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { encryptedColumnTransformer } from '../../security/encrypted-column.transformer';

@Entity('merchant_bank_accounts')
@Index('IDX_merchant_bank_accounts_merchant_currency_default', ['merchantId', 'currency', 'isDefault'])
export class MerchantBankAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() merchantId: string;
  @Column({ length: 3 }) currency: string;
  @Column({ transformer: encryptedColumnTransformer('merchant_bank_accounts.account_number') }) accountNumber: string;
  @Column({ transformer: encryptedColumnTransformer('merchant_bank_accounts.routing_number') }) routingNumber: string;
  @Column({ default: false }) isDefault: boolean;
  @CreateDateColumn() createdAt: Date;
}
