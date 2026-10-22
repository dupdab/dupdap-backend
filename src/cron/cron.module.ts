import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { StellarModule } from '../stellar/stellar.module';
import { SettlementsModule } from '../settlements/settlements.module';
import { QueueModule } from '../queues/queue.module';
import { CronJobLog } from './entities/cron-job-log.entity';
import { CronJobService } from './cron-job.service';
import { CronJobRegistry } from './cron-job.registry';
import { CronHealthProcessor } from './cron-health.processor';
import { UptimeHeartbeatService } from './uptime-heartbeat.service';
import { ApiKeyExpiryService } from './api-key-expiry.service';
import { Merchant } from '../merchants/entities/merchant.entity';
import { EmailModule } from '../email/email.module';
import { BlockchainWalletModule } from '../blockchain-wallet/blockchain-wallet.module';

const CRON_QUEUE = 'cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([CronJobLog, Merchant]),
    forwardRef(() => NotificationsModule),
    forwardRef(() => StellarModule),
    forwardRef(() => SettlementsModule),
    forwardRef(() => QueueModule),
    forwardRef(() => BlockchainWalletModule),
    EmailModule,
    BullModule.registerQueue({ name: CRON_QUEUE }),
  ],
  providers: [CronJobService, CronJobRegistry, CronHealthProcessor, UptimeHeartbeatService, ApiKeyExpiryService],
  exports: [CronJobService, CronJobRegistry, ApiKeyExpiryService],
})
export class CronModule {}
