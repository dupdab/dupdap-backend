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

const CRON_QUEUE = 'cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([CronJobLog]),
    forwardRef(() => NotificationsModule),
    forwardRef(() => StellarModule),
    forwardRef(() => SettlementsModule),
    forwardRef(() => QueueModule),
    BullModule.registerQueue({ name: CRON_QUEUE }),
  ],
  providers: [CronJobService, CronJobRegistry, CronHealthProcessor, UptimeHeartbeatService],
  exports: [CronJobService, CronJobRegistry],
})
export class CronModule {}

