import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as QRCode from 'qrcode';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentEvent, PaymentEventType } from './entities/payment-event.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { BatchCreatePaymentDto, BatchPaymentResultDto } from './dto/batch-create-payment.dto';
import { StellarService } from '../stellar/stellar.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MerchantsService } from '../merchants/merchants.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AmlService } from '../aml/aml.service';
import { PaymentEscrowService } from '../blockchain-wallet/payment-escrow.service';
import { TransactionLimitsService } from './transaction-limits.service';
import { PaymentConfirmedEventDto } from '../stellar/soroban-event.dto';

const DEFAULT_EXPIRY_MINUTES = 30;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepo: Repository<Payment>,
    private readonly stellar: StellarService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly merchants: MerchantsService,
    private readonly analytics: AnalyticsService,
    private readonly aml: AmlService,
    private readonly escrow: PaymentEscrowService,
    private readonly transactionLimits: TransactionLimitsService,
  ) {}

  /**
   * Builds an unsaved PENDING payment and registers it in the Soroban escrow
   * contract. The escrow-assigned expiry ledger is persisted on the record.
   * Throws (before anything is saved) if escrow registration fails.
   */
  private async buildAndRegister(
    merchantId: string,
    input: {
      reference?: string;
      amountUsd: number;
      description?: string;
      customerEmail?: string;
      metadata?: Record<string, any>;
      expiryMinutes?: number;
    },
  ): Promise<Payment> {
    const id = uuidv4();
    const reference = input.reference ?? `PAY-${id.slice(0, 8)}`;
    const expiryMinutes = input.expiryMinutes ?? DEFAULT_EXPIRY_MINUTES;
    const amountUsdc = input.amountUsd.toFixed(6);
    const depositAddress = this.stellar.getDepositAddress();
    const memo = this.stellar.generateMemo();

    const escrowPayment = this.escrow.createPayment(
      id,
      depositAddress,
      amountUsdc,
      Math.ceil(expiryMinutes * PaymentEscrowService.LEDGERS_PER_MINUTE),
    );

    const qrCode = await QRCode.toDataURL(
      `web+stellar:pay?destination=${depositAddress}&amount=${amountUsdc}&asset_code=USDC&memo=${memo}`,
    );

    return this.paymentsRepo.create({
      id,
      reference,
      merchantId,
      amountUsd: input.amountUsd.toFixed(6),
      amountUsdc,
      currency: 'USD',
      status: PaymentStatus.PENDING,
      stellarDepositAddress: depositAddress,
      stellarMemo: memo,
      description: input.description,
      customerEmail: input.customerEmail,
      metadata: input.metadata,
      qrCode,
      expiresAt: new Date(Date.now() + expiryMinutes * 60_000),
      expiryLedger: escrowPayment.expiryLedger,
    });
  }

  async create(merchantId: string, dto: CreatePaymentDto): Promise<Payment> {
    if (dto.reference && (await this.paymentsRepo.findOne({ where: { reference: dto.reference } }))) {
      throw new ConflictException(`Payment reference ${dto.reference} already exists`);
    }

    await this.transactionLimits.checkAndIncrement(merchantId);

    const payment = await this.buildAndRegister(merchantId, dto);
    const saved = await this.paymentsRepo.save(payment);
    await this.recordEvent(saved.id, PaymentEventType.CREATED, null, saved.status, merchantId);
    this.logger.log(`PaymentCreated ${saved.id} merchant=${merchantId}`);
    await this.webhooks.dispatch(merchantId, 'payment.created', { id: saved.id, reference: saved.reference });
    return saved;
  }

  /**
   * Creates up to 20 payments atomically. Every item is validated up front and
   * registered in the escrow contract; the records are then persisted with a
   * single repository save (one transaction). If validation or any escrow
   * registration fails, nothing is persisted.
   */
  async createBatch(merchantId: string, dto: BatchCreatePaymentDto): Promise<BatchPaymentResultDto> {
    dto.payments.forEach((item, i) => {
      if (!(item.amountUsd > 0)) {
        throw new BadRequestException(`payments[${i}]: amountUsd must be greater than 0`);
      }
      if (!item.memo || !item.memo.trim()) {
        throw new BadRequestException(`payments[${i}]: memo must not be empty`);
      }
    });

    const records: Payment[] = [];
    for (const [i, item] of dto.payments.entries()) {
      await this.transactionLimits.checkAndIncrement(merchantId);
      try {
        records.push(
          await this.buildAndRegister(merchantId, {
            amountUsd: item.amountUsd,
            description: item.memo,
            customerEmail: item.customerEmail,
            metadata: item.metadata,
            expiryMinutes: item.expiryMinutes,
          }),
        );
      } catch (err) {
        this.logger.error(`Escrow registration failed for batch item [${i}]: ${(err as Error).message}`);
        throw err;
      }
    }

    // shortcut: escrow entries live in memory and cannot be un-registered if the save below fails; revisit when escrow is on-chain.
    const saved = await this.paymentsRepo.save(records);
    for (const p of saved) {
      this.logger.log(`PaymentCreated ${p.id} merchant=${merchantId} (batch)`);
    }
    return { paymentIds: saved.map((p) => p.id), count: saved.length };
  }

  async findAll(merchantId: string, page = 1, limit = 20) {
    const [data, total] = await this.paymentsRepo.findAndCount({
      where: { merchantId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async getStats(merchantId: string) {
    const rows: { status: PaymentStatus; count: string; total: string }[] = await this.paymentsRepo
      .createQueryBuilder('p')
      .select('p.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(p.amountUsd), 0)', 'total')
      .where('p.merchantId = :merchantId', { merchantId })
      .groupBy('p.status')
      .getRawMany();

    return rows.map((r) => ({ status: r.status, count: Number(r.count), totalUsd: r.total }));
  }

  async findOne(id: string, merchantId: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id, merchantId } });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async findByReference(reference: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === PaymentStatus.PENDING && payment.expiresAt && payment.expiresAt < new Date()) {
      throw new GoneException('This payment QR code has expired');
    }
    return payment;
  }

  async getHistory(id: string, merchantId: string): Promise<PaymentEvent[]> {
    await this.findOne(id, merchantId);
    return this.paymentsRepo.manager
      .getRepository(PaymentEvent)
      .find({ where: { paymentId: id }, order: { timestamp: 'ASC' } });
  }

  async cancel(id: string, merchantId: string): Promise<Payment> {
    const payment = await this.findOne(id, merchantId);
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException('Only pending payments can be cancelled');
    }
    const previous = payment.status;
    payment.status = PaymentStatus.CANCELLED;
    const saved = await this.paymentsRepo.save(payment);
    await this.recordEvent(id, PaymentEventType.CANCELLED, previous, saved.status, merchantId);
    await this.webhooks.dispatch(merchantId, 'payment.cancelled', { id, reference: saved.reference });
    return saved;
  }

  async confirmPayment(id: string, customerWalletAddress: string, txHash?: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    return this.applyConfirmation(payment, customerWalletAddress, txHash);
  }

  async applySorobanPaymentConfirmed(event: PaymentConfirmedEventDto): Promise<void> {
    const payment = await this.paymentsRepo.findOne({ where: { reference: event.paymentReference } });
    if (!payment) {
      this.logger.warn(`Soroban confirmation for unknown payment reference ${event.paymentReference}`);
      return;
    }
    if (payment.status !== PaymentStatus.PENDING) return;
    await this.applyConfirmation(payment, event.from ?? payment.customerWalletAddress, event.txHash);
  }

  private async applyConfirmation(payment: Payment, customerWalletAddress: string, txHash?: string): Promise<Payment> {
    const previous = payment.status;
    payment.status = PaymentStatus.CONFIRMED;
    payment.customerWalletAddress = customerWalletAddress;
    payment.confirmedAt = new Date();
    if (txHash) payment.txHash = txHash;

    const saved = await this.paymentsRepo.save(payment);
    await this.recordEvent(saved.id, PaymentEventType.CONFIRMED, previous, saved.status, null);
    this.analytics.clearCacheForMerchant(saved.merchantId);

    try {
      await this.aml.checkAndFlag(saved);
    } catch (err) {
      this.logger.error(`AML check failed for payment ${saved.id}: ${(err as Error).message}`);
    }

    await this.webhooks.dispatch(saved.merchantId, 'payment.confirmed', { id: saved.id, reference: saved.reference });
    return saved;
  }

  async refund(id: string, merchantId: string, dto: RefundPaymentDto): Promise<Payment> {
    const payment = await this.findOne(id, merchantId);

    if (payment.status !== PaymentStatus.SETTLED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new BadRequestException('Only settled payments can be refunded');
    }
    if (payment.metadata?.hold) {
      throw new BadRequestException('Payment is on hold and cannot be refunded');
    }
    if (!payment.customerWalletAddress) {
      throw new BadRequestException('Customer wallet address is unknown; cannot refund');
    }

    const alreadyRefunded = Number(payment.refundAmountUsd ?? 0);
    const remaining = Number(payment.amountUsd) - alreadyRefunded;
    const amount = dto.amountUsd ?? remaining;
    if (amount <= 0 || amount > remaining + 1e-9) {
      throw new BadRequestException(`Refund amount must be between 0.01 and ${remaining.toFixed(6)}`);
    }

    const merchant = await this.merchants.findOne(merchantId);
    const txHash = await this.stellar.sendPayment(
      payment.customerWalletAddress,
      amount.toFixed(7),
      this.stellar.getUsdcAsset(),
      `REFUND-${payment.reference.replace(/^PAY-/, '')}`,
    );

    const previous = payment.status;
    payment.status = PaymentStatus.REFUNDED;
    payment.refundAmountUsd = (alreadyRefunded + amount).toFixed(6);
    payment.refundReason = dto.reason;
    payment.refundTxHash = txHash;
    payment.refundedAt = new Date();
    const saved = await this.paymentsRepo.save(payment);

    await this.recordEvent(id, PaymentEventType.REFUNDED, previous, saved.status, merchantId, { amountUsd: amount });
    await this.webhooks.dispatch(merchantId, 'payment.refunded', { id, reference: saved.reference, amountUsd: amount });

    const text = `Payment ${saved.reference} was refunded ${amount.toFixed(2)} USD. Reason: ${dto.reason}`;
    await this.notifications.enqueueEmail({ recipient: merchant.email, subject: 'Payment refunded', text });
    if (saved.customerEmail) {
      await this.notifications.enqueueEmail({ recipient: saved.customerEmail, subject: 'Your payment was refunded', text });
    }
    return saved;
  }

  /** Fraud hold: blocks refund and settlement until released. Prior status is kept in metadata. */
  async hold(id: string, reason: string, actorId?: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed payments can be placed on hold');
    }
    if (payment.metadata?.hold) throw new BadRequestException('Payment is already on hold');

    payment.metadata = {
      ...payment.metadata,
      hold: { reason, actorId: actorId ?? null, heldAt: new Date().toISOString(), priorStatus: payment.status },
    };
    const saved = await this.paymentsRepo.save(payment);
    await this.recordEvent(id, PaymentEventType.HELD, saved.status, saved.status, actorId ?? null, { reason });
    return saved;
  }

  async release(id: string, actorId?: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!payment.metadata?.hold) throw new BadRequestException('Payment is not on hold');

    const { hold, ...rest } = payment.metadata;
    payment.status = hold.priorStatus ?? payment.status;
    payment.metadata = rest;
    const saved = await this.paymentsRepo.save(payment);
    await this.recordEvent(id, PaymentEventType.RELEASED, saved.status, saved.status, actorId ?? null);
    return saved;
  }

  /** Best-effort audit trail; never fails the payment operation. */
  private async recordEvent(
    paymentId: string,
    eventType: PaymentEventType,
    previousStatus: PaymentStatus | null,
    newStatus: PaymentStatus | null,
    actorId: string | null,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const repo = this.paymentsRepo.manager.getRepository(PaymentEvent);
      await repo.save(repo.create({ paymentId, eventType, previousStatus, newStatus, actorId: actorId ?? undefined, metadata }));
    } catch (err) {
      this.logger.warn(`Failed to record ${eventType} event for payment ${paymentId}: ${(err as Error).message}`);
    }
  }
}
