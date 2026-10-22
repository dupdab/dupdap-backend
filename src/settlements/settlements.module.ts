import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementsService } from './settlements.service';
import { AdminSettlementsController } from './admin-settlements.controller';
import { Settlement } from './entities/settlement.entity';
import { Payment } from '../payments/entities/payment.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AdminAlertModule } from '../alerts/admin-alert.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { EmailModule } from '../email/email.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StellarModule } from '../stellar/stellar.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CronModule } from '../cron/cron.module';
import { RetryModule } from '../retry/retry.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Settlement, Payment, AuditLog]),
    AdminAlertModule,
    WebhooksModule,
    EmailModule,
    MerchantsModule,
    NotificationsModule,
    StellarModule,
    AnalyticsModule,
    CronModule,
    RetryModule,
  ],
  controllers: [AdminSettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
