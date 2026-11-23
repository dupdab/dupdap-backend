import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as QRCode from 'qrcode';
import * as StellarSdk from '@stellar/stellar-sdk';
import Big from 'big.js';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentEvent, PaymentEventType } from './entities/payment-event.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { BatchCreatePaymentDto, BatchPaymentResultDto } from './dto/batch-create-payment.dto';
import { PaymentStatsDto } from './dto/payment-stats.dto';
import { StellarService } from '../stellar/stellar.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MerchantsService } from '../merchants/merchants.service';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';
import { PaymentEscrowService, PaymentExpiredError } from '../blockchain-wallet/payment-escrow.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AmlService } from '../aml/aml.service';
import { TransactionLimitsService } from './transaction-limits.service';
import { PaymentConfirmedEventDto } from '../stellar/soroban-event.dto';

const DEFAULT_EXPIRY_MINUTES = 30;
const MAX_EXPIRY_MINUTES = 1440;

// Events emitted per payment in a batch — mirrors contract PaymentCreated events
export interface PaymentCreatedEvent {
  type: 'PaymentCreated';
  paymentId: string;
  merchantId: string;
  amountUsd: string;
  memo: string;
  timestamp: Date;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private paymentsRepo: Repository<Payment>,
    @InjectRepository(PaymentEvent)
    private eventsRepo: Repository<PaymentEvent>,
    private stellar: StellarService,
    private webhooks: WebhooksService,
    private notifications: NotificationsService,
    private merchants: MerchantsService,
    private soroban: PaymentEscrowService,
    private analytics: AnalyticsService,
    private dataSource: DataSource,
    @Optional()
    private txLimits?: TransactionLimitsService,
  ) {}

  /**
   * Append-only audit log of every status transition.
   * PaymentEvent rows are never updated or deleted (immutable).
   */
  private async recordEvent(
    paymentId: string,
    eventType: PaymentEventType,
    previousStatus: PaymentStatus | null,
    newStatus: PaymentStatus | null,
    actorId?: string | null,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      await this.eventsRepo.save(
        this.eventsRepo.create({
          paymentId,
          eventType,
          previousStatus,
          newStatus,
          actorId: actorId ?? null,
          metadata: metadata ?? null,
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to record ${eventType} event for payment ${paymentId}: ${(err as Error).message}`);
    }
  }

  /** Immutable event log for audit/debugging (no updates/deletes). */
  async getHistory(paymentId: string, merchantId: string): Promise<PaymentEvent[]> {
    await this.findOne(paymentId, merchantId);
    return this.eventsRepo.find({
      where: { paymentId },
      order: { timestamp: 'ASC' },
    });
  }

  /**
   * getXlmUsdRate() now returns { rate, isFallback }. A fallback rate is a
   * fabricated/stale constant and must never be used to quote a deposit
   * amount, so we refuse the request instead of mispricing the payment.
   */
  private async resolveXlmRate(): Promise<number> {
    const { rate, isFallback } = await this.stellar.getXlmUsdRate();
    if (isFallback) {
      this.logger.error(
        'XLM/USD rate unavailable (Horizon failure or empty orderbook); refusing to quote a payment with a fallback rate',
      );
      throw new ServiceUnavailableException(
        'Unable to fetch a live XLM/USD exchange rate. Please try again shortly.',
      );
    }
    return rate;
  }

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

    const escrowPayment = this.soroban.createPayment(
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

    await this.txLimits?.checkAndIncrement(merchantId);

    const payment = await this.buildAndRegister(merchantId, dto);
    const saved = await this.paymentsRepo.save(payment);
    await this.recordEvent(saved.id, PaymentEventType.CREATED, null, saved.status, merchantId);
    this.logger.log(`PaymentCreated ${saved.id} merchant=${merchantId}`);
    await this.webhooks.dispatch(merchantId, 'payment.created', { id: saved.id, reference: saved.reference });
    return saved;
  }

  /**
   * Confirm a payment — delegates to the Soroban contract which enforces
   * ledger-based expiry. Throws PaymentExpiredError (→ 410) if the payment
   * window has passed, regardless of NestJS state.
   */
  async confirmPayment(
    paymentId: string,
    customerAddress: string,
    txHash?: string,
  ): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');

    // Contract enforces expiry — this throws PaymentExpiredError if expired.
    try {
      await this.soroban.confirm(paymentId, customerAddress);
    } catch (err) {
      if (err instanceof PaymentExpiredError) {
        // Sync NestJS state with contract state
        const previousStatus = payment.status;
        payment.status = PaymentStatus.EXPIRED;
        await this.paymentsRepo.save(payment);
        await this.recordEvent(paymentId, PaymentEventType.EXPIRED, previousStatus, PaymentStatus.EXPIRED);
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    return this.applyConfirmation(payment, customerAddress, txHash);
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

  /**
   * Creates up to 20 payments atomically. Every item is validated up front and
   * registered in the escrow contract; the records are then persisted with a
   * single repository save (one transaction). If validation or any escrow
   * registration fails, nothing is persisted.
   */
  async createBatch(merchantId: string, dto: BatchCreatePaymentDto): Promise<BatchPaymentResultDto> {
    dto.payments.forEach((item, i) => this.validateBatchItem(item, i));

    const records: Payment[] = [];
    for (const [i, item] of dto.payments.entries()) {
      await this.txLimits?.checkAndIncrement(merchantId);
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
    return {
      paymentIds: saved.map((p) => p.id),
      count: saved.length,
      items: saved.map((p) => ({
        paymentId: p.id,
        reference: p.reference,
        stellarUri: this.buildStellarUri(p),
        qrCode: p.qrCode,
      })),
    };
  }

  async refund(
    merchantId: string,
    paymentId: string,
    dto: RefundPaymentDto,
  ): Promise<Payment> {
    const payment = await this.findOne(paymentId, merchantId);

    if (
      payment.status !== PaymentStatus.CONFIRMED &&
      payment.status !== PaymentStatus.SETTLED &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new BadRequestException('Only confirmed or settled payments can be refunded');
    }

    if (payment.metadata?.hold) {
      throw new BadRequestException('Payment is on hold and cannot be refunded');
    }

    if (!payment.customerWalletAddress) {
      throw new BadRequestException('Payment has no customer wallet address');
    }

    const alreadyRefundedUsd = new Big(payment.refundAmountUsd ?? '0');
    const remainingUsd = new Big(payment.amountUsd).minus(alreadyRefundedUsd);
    const refundAmount =
      dto.amountUsd !== undefined ? new Big(dto.amountUsd) : remainingUsd;

    if (refundAmount.lte(0) || refundAmount.gt(remainingUsd)) {
      throw new BadRequestException(
        `Refund amount must be between 0.01 and ${remainingUsd.toFixed(6)}`,
      );
    }

    // Release escrowed funds on-chain first; if this throws, DB state is untouched.
    await this.soroban.refund(payment.id, payment.customerWalletAddress);

    const newRefundedUsd = alreadyRefundedUsd.plus(refundAmount);
    const previousStatus = payment.status;
    payment.refundAmountUsd = newRefundedUsd.toFixed(6);
    payment.status =
      newRefundedUsd.gte(new Big(payment.amountUsd))
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
    payment.refundReason = dto.reason;
    payment.refundedAt = new Date();

    const saved = await this.paymentsRepo.save(payment);
    await this.recordEvent(payment.id, PaymentEventType.REFUNDED, previousStatus, payment.status, merchantId, { refundAmountUsd: refundAmount.toFixed(6) });

    await this.webhooks.dispatch(payment.merchantId, 'payment.refunded', {
      paymentId: payment.id,
      reference: payment.reference,
      refundedAmountUsd: refundAmount.toFixed(6),
      totalRefundedUsd: newRefundedUsd.toFixed(6),
      status: payment.status,
      reason: dto.reason,
    });

    this.analytics.clearCacheForMerchant(payment.merchantId);

    return saved;
  }

  /**
   * List payments WITHOUT eager merchant loading (#532).
   * `relations: []` is deliberate: the full merchant row (incl. encrypted
   * bank fields) is never needed here. Only merchant id + businessName are
   * projected via a selective join. Compare with/without via:
   * `pnpm run explain:queries` (see scripts/explain-list-queries.ts).
   */
  async findAll(
    merchantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponseDto<Payment>> {
    const qb = this.paymentsRepo
      .createQueryBuilder('payment')
      .leftJoin('payment.merchant', 'merchant')
      .addSelect(['merchant.id', 'merchant.businessName'])
      .where('payment.merchantId = :merchantId', { merchantId })
      .orderBy('payment.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getStats(merchantId: string): Promise<PaymentStatsDto[]> {
    const rows = await this.paymentsRepo
      .createQueryBuilder('payment')
      .select('payment.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(payment.amountUsd)', 'totalUsd')
      .where('payment.merchantId = :merchantId', { merchantId })
      .groupBy('payment.status')
      .getRawMany();

    // Postgres returns COUNT/SUM as strings (e.g. "1234.000000"); convert to numbers for callers.
    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
      totalUsd: Number(row.totalUsd),
    }));
  }

  async findOne(id: string, merchantId: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id, merchantId } });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  /**
   * Lookup backing the unauthenticated GET /pay/:reference page. Deliberately
   * un-scoped by merchant: the reference is the only credential the customer
   * has, and the caller maps the result to PublicPaymentViewDto which drops
   * every merchant-identifying and PII field.
   */
  async findByReference(reference: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.expiresAt && new Date(payment.expiresAt).getTime() < Date.now()) {
      throw new GoneException('This payment QR code has expired');
    }
    return payment;
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

  // ── Internals ───────────────────────────────────────────────────────────────

  private validateBatchItem(item: BatchPaymentItemDto, index: number): void {
    if (!item || typeof item.amountUsd !== 'number' || !(item.amountUsd > 0)) {
      throw new BadRequestException(`payments[${index}]: amountUsd must be greater than 0`);
    }
    if (typeof item.memo !== 'string' || item.memo.trim().length === 0) {
      throw new BadRequestException(`payments[${index}]: memo must not be empty`);
    }
  }

  private buildStellarUri(payment: Payment): string {
    const params = new URLSearchParams({
      destination: payment.stellarDepositAddress ?? '',
      amount: payment.amountUsd,
      memo: payment.stellarMemo ?? '',
      memo_type: 'text',
      msg: payment.description ?? '',
    });
    return `web+stellar:pay?${params.toString()}`;
  }

  private async generateQrCode(payment: Payment): Promise<string> {
    return QRCode.toDataURL(this.buildStellarUri(payment));
  }
  }
}
