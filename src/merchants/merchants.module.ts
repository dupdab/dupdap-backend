import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantsService } from './merchants.service';
import { MerchantsController } from './merchants.controller';
import { MerchantsAdminController } from './merchants-admin.controller';
import { Merchant } from './entities/merchant.entity';
import { NotificationPreference } from '../notifications/entities/notification-preference.entity';
import { NotificationPrefsService } from '../notifications/notification-prefs.service';
import { CacheModule } from '../cache/cache.module';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { MerchantBankAccount } from './entities/merchant-bank-account.entity';
import { EmailModule } from '../email/email.module';
import { MerchantComplianceController } from './merchant-compliance.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Merchant, MerchantBankAccount, NotificationPreference, AuditLog]), CacheModule, EmailModule],
  controllers: [MerchantsController, MerchantsAdminController, MerchantComplianceController],
  providers: [MerchantsService, NotificationPrefsService],
  exports: [MerchantsService, NotificationPrefsService],
})
export class MerchantsModule {}
