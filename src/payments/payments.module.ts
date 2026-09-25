import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController, PublicPaymentController } from './payments.controller';
import { Payment } from './entities/payment.entity';
import { StellarModule } from '../stellar/stellar.module';
import { CacheModule } from '../cache/cache.module';
import { IdempotencyInterceptor } from '../payment/idempotency.interceptor';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { SorobanModule } from '../soroban/soroban.module';
import { PaymentEscrowService } from '../blockchain-wallet/payment-escrow.service';
import { PaymentsSorobanListener } from './payments-soroban.listener';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    forwardRef(() => StellarModule),
    CacheModule,
    WebhooksModule,
    NotificationsModule,
    MerchantsModule,
    ConfigModule,
    SorobanModule,
  ],
  controllers: [PaymentsController, PublicPaymentController],
  providers: [PaymentsService, IdempotencyInterceptor, PaymentEscrowService, PaymentsSorobanListener],
  exports: [PaymentsService],
})
export class PaymentsModule {}
