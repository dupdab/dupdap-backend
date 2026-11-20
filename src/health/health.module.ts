import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { HealthController } from './health.controller';
import { CacheModule } from '../cache/cache.module';
import { QUEUE_NAMES } from '../queues/queue.constants';

@Module({
  imports: [
    TerminusModule,
    HttpModule,
    CacheModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.webhookDelivery }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
