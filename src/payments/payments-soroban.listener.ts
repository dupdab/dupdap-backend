import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentConfirmedEventDto } from '../stellar/soroban-event.dto';
import { Payment, PaymentStatus } from './entities/payment.entity';

@Injectable()
export class PaymentsSorobanListener {
  private readonly logger = new Logger(PaymentsSorobanListener.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
  ) {}

  @OnEvent('soroban.payment.confirmed', { async: true })
  async handlePaymentConfirmed(event: PaymentConfirmedEventDto): Promise<void> {
    // Conditional UPDATE: only the first concurrent event can transition the
    // payment out of a non-confirmed status, so duplicates are no-ops.
    const result = await this.paymentsRepository
      .createQueryBuilder()
      .update(Payment)
      .set({
        status: PaymentStatus.CONFIRMED,
        confirmedAt: new Date(),
        txHash: event.txHash,
      })
      .where('reference = :reference', { reference: event.paymentReference })
      .andWhere('status != :confirmed', { confirmed: PaymentStatus.CONFIRMED })
      .execute();

    if (!result.affected) {
      this.logger.log(
        `Discarding duplicate payment.confirmed event ${event.eventId} for payment ${event.paymentReference}`,
      );
      return;
    }

    this.logger.log(
      `Applied payment.confirmed event ${event.eventId} to payment ${event.paymentReference}`,
    );
  }
}


