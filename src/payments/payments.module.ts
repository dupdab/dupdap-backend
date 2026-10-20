import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController, PublicPaymentController } from './payments.controller';
import { Payment } from './entities/payment.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { StellarModule } from '../stellar/stellar.module';
import { CacheModule } from '../cache/cache.module';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { SorobanModule } from '../soroban/soroban.module';
import { PaymentEscrowService } from '../blockchain-wallet/payment-escrow.service';
import { SorobanService } from '../blockchain-wallet/soroban.service';
import { AmlModule } from '../aml/aml.module';
import { PaymentsSorobanListener } from './payments-soroban.listener';
import { TransactionLimitsService } from './transaction-limits.service';
import { AdminAlertModule } from '../alerts/admin-alert.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentEvent]),
    forwardRef(() => StellarModule),
    CacheModule,
    WebhooksModule,
    NotificationsModule,
    MerchantsModule,
    ConfigModule,
    AdminAlertModule,
    forwardRef(() => AmlModule),
  ],
  controllers: [PaymentsController, PublicPaymentController],
  providers: [PaymentsService, IdempotencyInterceptor, PaymentEscrowService, PaymentsSorobanListener, TransactionLimitsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
