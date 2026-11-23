import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentConfirmedEventDto } from '../stellar/soroban-event.dto';
import { Payment, PaymentStatus } from './entities/payment.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  async applySorobanPaymentConfirmed(event: PaymentConfirmedEventDto): Promise<void> {
    // Conditional UPDATE: Postgres row locks make concurrent deliveries serialize, and only the first
    // one still sees status = PENDING, so duplicates affect 0 rows instead of re-confirming.
    const result = await this.paymentRepo.update(
      { reference: event.paymentReference, status: PaymentStatus.PENDING },
      { status: PaymentStatus.CONFIRMED, txHash: event.txHash, confirmedAt: event.ledgerClosedAt },
    );

    if (!result.affected) {
      this.logger.warn(
        `Discarded soroban payment.confirmed for ${event.paymentReference} (tx ${event.txHash}): not pending or unknown`,
      );
    }
  }
}
