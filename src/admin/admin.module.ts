import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { CronAdminController } from './cron-admin.controller';
import { Merchant } from '../merchants/entities/merchant.entity';
import { Payment } from '../payments/entities/payment.entity';
import { FeeConfig } from '../fee-config/entities/fee-config.entity';
import { FeeHistory } from '../fee-config/entities/fee-history.entity';
import { CronModule } from '../cron/cron.module';
import { CronJobLog } from '../cron/entities/cron-job-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { RatesModule } from '../rates/rates.module';
import { CacheModule } from '../cache/cache.module';
import { Settlement } from '../settlements/entities/settlement.entity';
import { StellarModule } from '../stellar/stellar.module';
import { BlockchainWalletModule } from '../blockchain-wallet/blockchain-wallet.module';
import { IpAllowlistGuard } from '../security/ip-allowlist.guard';
import { EncryptionAdminController } from './encryption-admin.controller';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsExportController } from './analytics-export.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Merchant,
      Payment,
      Settlement,
      FeeConfig,
      FeeHistory,
      AuditLog,
      CronJobLog,
      MonthlyPaymentVolume,
    ]),
    CronModule,
    RatesModule,
    CacheModule,
    StellarModule,
    BlockchainWalletModule,
  ],
  controllers: [AdminController, CronAdminController, EncryptionAdminController, AnalyticsExportController],
  providers: [AdminService, AuditService, IpAllowlistGuard, AnalyticsExportService],
  exports: [AdminService, TypeOrmModule],
})
export class AdminModule {}
