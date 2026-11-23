import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController, PublicPaymentController } from './payments.controller';
import { Payment } from './entities/payment.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { PaymentDispute } from './entities/payment-dispute.entity';
import { DisputesService } from './disputes.service';
import { PaymentExpiryService } from './payment-expiry.service';
import { DisputesController } from './disputes.controller';
import { SettlementsModule } from '../settlements/settlements.module';
import { StellarModule } from '../stellar/stellar.module';
import { CacheModule } from '../cache/cache.module';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { SorobanModule } from '../soroban/soroban.module';
import { PaymentEscrowService } from '../blockchain-wallet/payment-escrow.service';
import { AmlModule } from '../aml/aml.module';
import { PaymentsSorobanListener } from './payments-soroban.listener';
import { TransactionLimitsService } from './transaction-limits.service';
import { PaymentCreationRateLimitService } from './payment-creation-rate-limit.service';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import { AdminAlertModule } from '../alerts/admin-alert.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PrometheusModule } from '../prometheus/prometheus.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentEvent, PaymentDispute]),
    forwardRef(() => StellarModule),
    CacheModule,
    WebhooksModule,
    NotificationsModule,
    MerchantsModule,
    ConfigModule,
    AdminAlertModule,
    PrometheusModule,
    forwardRef(() => AmlModule),
    SettlementsModule,
    RuntimeConfigModule,
    SorobanModule,
    AnalyticsModule,
  ],
  controllers: [PaymentsController, PublicPaymentController, DisputesController],
  providers: [PaymentsService, DisputesService, PaymentExpiryService, IdempotencyInterceptor, PaymentEscrowService, PaymentsSorobanListener, TransactionLimitsService, PaymentCreationRateLimitService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
