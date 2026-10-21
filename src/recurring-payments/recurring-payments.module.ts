import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecurringPayment } from './entities/recurring-payment.entity';
import { RecurringPaymentsService } from './recurring-payments.service';
import { RecurringPaymentsController } from './recurring-payments.controller';
import { Merchant } from '../merchants/entities/merchant.entity';
import { PaymentsModule } from '../payments/payments.module';
import { EmailModule } from '../email/email.module';
import { CronModule } from '../cron/cron.module';

@Module({
  imports: [TypeOrmModule.forFeature([RecurringPayment, Merchant]), PaymentsModule, EmailModule, CronModule],
  controllers: [RecurringPaymentsController],
  providers: [RecurringPaymentsService],
  exports: [RecurringPaymentsService],
})
export class RecurringPaymentsModule {}
