import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantAnalyticsController } from './merchant-analytics.controller';
import { MerchantAnalyticsService } from './merchant-analytics.service';
import { CacheModule } from '../cache/cache.module';
import { Payment } from '../payments/entities/payment.entity';
import { Merchant } from '../merchants/entities/merchant.entity';
import { AnalyticsModule } from './analytics.module';
import { MerchantAnalyticsExportController } from './merchant-analytics-export.controller';

@Module({
  imports: [CacheModule, TypeOrmModule.forFeature([Payment, Merchant]), AnalyticsModule],
  controllers: [MerchantAnalyticsController, MerchantAnalyticsExportController],
  providers: [MerchantAnalyticsService],
})
export class MerchantAnalyticsModule {}
