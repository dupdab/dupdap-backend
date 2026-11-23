import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentEscrowService } from '../blockchain-wallet/payment-escrow.service';
import { RefundPaymentDto } from './dto/refund-payment.dto';

/**
 * PaymentsService — refund path.
 *
 * NOTE: the full service body is not present in this checkout; only the
 * refund flow required by issue #806 is implemented here.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly paymentEscrowService: PaymentEscrowService,
  ) {}

  /**
   * Refund a settled payment.
   *
   * The Soroban contract refund is invoked BEFORE the DB status is updated.
   * If the contract call fails, the error propagates and the payment row is
   * left untouched (no REFUNDED status, no refund amount persisted).
   */
  async refund(
    paymentId: string,
    merchantId: string,
    dto: RefundPaymentDto,
  ): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId, merchantId },
    });

    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    if (payment.status !== PaymentStatus.SETTLED) {
      throw new BadRequestException(
        `Payment ${paymentId} is not settled and cannot be refunded`,
      );
    }

    const customerWalletAddress = payment.customerWalletAddress;
    if (!customerWalletAddress) {
      throw new BadRequestException(
        `Payment ${paymentId} has no customer wallet address to refund to`,
      );
    }

    // On-chain refund first: a failure here aborts before any DB mutation.
    await this.paymentEscrowService.refund(paymentId, customerWalletAddress);

    const refundAmountUsd = dto.amountUsd
      ? Number(dto.amountUsd).toFixed(6)
      : payment.amountUsd;

    payment.status = PaymentStatus.REFUNDED;
    payment.refundAmountUsd = refundAmountUsd;
    payment.refundReason = dto.reason ?? payment.refundReason;

    this.logger.log(
      `Refunded payment ${paymentId} on-chain to ${customerWalletAddress} (${refundAmountUsd} USD)`,
    );

    return this.paymentRepository.save(payment);
  }
}
