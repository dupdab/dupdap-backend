import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as QRCode from 'qrcode';
import * as StellarSdk from '@stellar/stellar-sdk';
import Big from 'big.js';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { BatchCreatePaymentDto, BatchPaymentResultDto } from './dto/batch-create-payment.dto';
import { StellarService } from '../stellar/stellar.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MerchantsService } from '../merchants/merchants.service';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';
import { SorobanService, PaymentExpiredError } from '../blockchain-wallet/soroban.service';
import { AnalyticsService } from '../analytics/analytics.service';

// Events emitted per payment in a batch — mirrors contract PaymentCreated events
export interface PaymentCreatedEvent {
  type: 'PaymentCreated';
  paymentId: string;
  merchantId: string;
  amountUsd: number;
  memo: string;
  timestamp: Date;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private paymentsRepo: Repository<Payment>,
    private stellar: StellarService,
    private webhooks: WebhooksService,
    private notifications: NotificationsService,
    private merchants: MerchantsService,
    private soroban: SorobanService,
    private analytics: AnalyticsService,
    private dataSource: DataSource,
  ) {}

  async create(merchantId: string, dto: CreatePaymentDto): Promise<Payment> {
    const xlmRate = await this.stellar.getXlmUsdRate();
    const amountXlm = new Big(dto.amountUsd).div(xlmRate);

    const memo = this.stellar.generateMemo();
    const depositAddress = this.stellar.getDepositAddress();

    const stellarUri = `web+stellar:pay?destination=${depositAddress}&amount=${amountXlm.toFixed(7)}&memo=${memo}&memo_type=text`;
    const qrCode = await QRCode.toDataURL(stellarUri);

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + (dto.expiryMinutes ?? 30));

    const payment = this.paymentsRepo.create({
      id: uuidv4(),
      reference: `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      merchantId,
      amountUsd: dto.amountUsd,
      amountXlm: parseFloat(amountXlm.toFixed(7)),
      description: dto.description,
      customerEmail: dto.customerEmail,
      metadata: dto.metadata,
      stellarDepositAddress: depositAddress,
      stellarMemo: memo,
      qrCode,
      expiresAt,
      status: PaymentStatus.PENDING,
    });

    const saved = await this.paymentsRepo.save(payment);

    // Register in Soroban contract with ledger-based expiry.
    // expiryLedgers defaults to 360 (≈ 30 min at 1 ledger/5 s).
    const expiryLedgers = (dto.expiryMinutes ?? 30) * SorobanService.LEDGERS_PER_MINUTE;
    const contractPayment = this.soroban.createPayment(
      saved.id,
      depositAddress,
      '0', // amountUsdc populated on confirmation
      expiryLedgers,
    );

    // Persist the expiry_ledger so NestJS cron can query it without RPC calls.
    saved.expiryLedger = contractPayment.expiryLedger;
    return this.paymentsRepo.save(saved);
  }

  /**
   * Confirm a payment — delegates to the Soroban contract which enforces
   * ledger-based expiry. Throws PaymentExpiredError (→ 410) if the payment
   * window has passed, regardless of NestJS state.
   */
  async confirmPayment(
    paymentId: string,
    customerAddress: string,
  ): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');

    // Contract enforces expiry — this throws PaymentExpiredError if expired.
    try {
      await this.soroban.confirm(paymentId, customerAddress);
    } catch (err) {
      if (err instanceof PaymentExpiredError) {
        // Sync NestJS state with contract state
        payment.status = PaymentStatus.EXPIRED;
        await this.paymentsRepo.save(payment);
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    payment.status = PaymentStatus.CONFIRMED;
    payment.customerWalletAddress = customerAddress;
    payment.confirmedAt = new Date();
    const saved = await this.paymentsRepo.save(payment);

    // Invalidate merchant analytics caches since funnel and comparison data may have changed.
    this.analytics.clearCacheForMerchant(payment.merchantId);

    return saved;
  }

  async applySorobanPaymentConfirmed(event: { paymentReference: string; txHash?: string; amount?: number; asset?: string; from?: string }): Promise<void> {
    const payment = await this.paymentsRepo.findOne({ where: { id: event.paymentReference } });
    if (!payment) {
      this.logger.warn(`Soroban payment confirmed for unknown payment ${event.paymentReference}`);
      return;
    }

    if (payment.status === PaymentStatus.CONFIRMED) {
      return;
    }

    payment.status = PaymentStatus.CONFIRMED;
    payment.confirmedAt = new Date();
    if (event.txHash) payment.txHash = event.txHash;
    if (event.from) payment.customerWalletAddress = event.from;
    await this.paymentsRepo.save(payment);

    this.analytics.clearCacheForMerchant(payment.merchantId);
  }

  /**
   * create_batch — mirrors the Soroban contract's create_batch(payments: Vec<PaymentInput>).
   *
   * Creates up to 20 payment requests atomically. Validates every entry first
   * so the entire batch reverts (throws) if any single input is invalid —
   * no partial writes ever reach the database.
   *
   * Emits a PaymentCreated event for each entry, matching the contract event log.
   */
  async createBatch(
    merchantId: string,
    dto: BatchCreatePaymentDto,
  ): Promise<BatchPaymentResultDto> {
    const { payments: items } = dto;

    // ── Validate all inputs before touching the DB (atomic revert on failure) ──
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.amountUsd || item.amountUsd <= 0) {
        throw new BadRequestException(
          `Batch item [${i}]: amountUsd must be greater than 0`,
        );
      }
      if (!item.memo || item.memo.trim().length === 0) {
        throw new BadRequestException(
          `Batch item [${i}]: memo must not be empty`,
        );
      }
    }

    // ── Build all payment records in memory ───────────────────────────────────
    const xlmRate = await this.stellar.getXlmUsdRate();
    const depositAddress = this.stellar.getDepositAddress();
    const now = Date.now();

    const records: Payment[] = [];
    const events: PaymentCreatedEvent[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const amountXlm = new Big(item.amountUsd).div(xlmRate);
      const memo = this.stellar.generateMemo();

      const stellarUri =
        `web+stellar:pay?destination=${depositAddress}` +
        `&amount=${amountXlm.toFixed(7)}&memo=${memo}&memo_type=text`;
      const qrCode = await QRCode.toDataURL(stellarUri);

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + (item.expiryMinutes ?? 30));

      const payment = this.paymentsRepo.create({
        id: uuidv4(),
        // Unique reference per item — suffix with batch index to avoid collisions
        reference: `PAY-${now}-${Math.random().toString(36).substring(2, 6).toUpperCase()}-B${i}`,
        merchantId,
        amountUsd: item.amountUsd,
        amountXlm: parseFloat(amountXlm.toFixed(7)),
        description: item.memo,
        customerEmail: item.customerEmail,
        metadata: item.metadata,
        stellarDepositAddress: depositAddress,
        stellarMemo: memo,
        qrCode,
        expiresAt,
        status: PaymentStatus.PENDING,
      });

      records.push(payment);
      events.push({
        type: 'PaymentCreated',
        paymentId: payment.id,
        merchantId,
        amountUsd: item.amountUsd,
        memo: item.memo,
        timestamp: new Date(),
      });
    }

    // ── Persist all records inside one DB transaction. A plain array save()
    //    is not guaranteed atomic against constraint violations that only
    //    manifest at insert time (e.g. a unique-constraint collision) or a
    //    connection loss mid-batch — wrapping in a transaction backs the
    //    "no partial writes" contract documented above with the database. ──
    const saved = await this.dataSource.transaction(async (manager) => {
      return manager.save(records);
    });

    // ── Emit PaymentCreated event for each entry (mirrors contract event log) ─
    for (const event of events) {
      this.logger.log(
        `PaymentCreated: id=${event.paymentId} merchant=${merchantId} amount=${event.amountUsd} memo="${event.memo}"`,
      );
    }

    return {
      paymentIds: saved.map((p) => p.id),
      count: saved.length,
    };
  }

  async findAll(merchantId: string, page = 1, limit = 20) {
    const [data, total] = await this.paymentsRepo.findAndCount({
      where: { merchantId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return PaginatedResponseDto.of(data, total, page, limit);
  }

  async findOne(id: string, merchantId: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id, merchantId } });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async findByReference(reference: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async getStats(merchantId: string) {
    const result = await this.paymentsRepo
      .createQueryBuilder('payment')
      .select('payment.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(payment.amountUsd)', 'totalUsd')
      .where('payment.merchantId = :merchantId', { merchantId })
      .groupBy('payment.status')
      .getRawMany();

    return result;
  }

  async refund(id: string, merchantId: string, dto: RefundPaymentDto): Promise<Payment> {
    const merchant = await this.merchants.findOne(merchantId);

    let payment: Payment;
    let refundAmountUsd: number;
    let txHash: string;

    // Determine asset and amount for Stellar transfer
    let asset: StellarSdk.Asset;
    let amountStr: string;

    if (payment.amountUsdc) {
      asset = this.stellar.getUsdcAsset();
      const ratio = new Big(refundAmountUsd).div(payment.amountUsd);
      const amountUsdc = new Big(payment.amountUsdc).times(ratio);
      amountStr = amountUsdc.toFixed(7);
    } else {
      asset = StellarSdk.Asset.native();
      const ratio = new Big(refundAmountUsd).div(payment.amountUsd);
      const amountXlm = new Big(payment.amountXlm).times(ratio);
      amountStr = amountXlm.toFixed(7);
    }

        const totalRefundedUsd = alreadyRefundedUsd + refundAmountUsd;
        payment.status =
          totalRefundedUsd >= payment.amountUsd
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED;
        payment.refundAmountUsd = totalRefundedUsd;
        payment.refundReason = dto.reason;
        payment.refundTxHash = txHash;
        payment.refundedAt = new Date();

        const saved = await manager.save(payment);

        return { saved, refundAmountUsd, txHash };
      });

      payment = result.saved;
      refundAmountUsd = result.refundAmountUsd;
      txHash = result.txHash;
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) {
        throw err;
      }
      throw new BadRequestException(`Stellar refund failed: ${err.message}`);
    }

    // Step 2: webhook + email dispatch happens *after* the financial action
    // has already succeeded and been saved. Failures here (e.g. a webhook
    // queue error) must not be reported as a refund failure — the funds have
    // genuinely moved. Log and continue on a best-effort basis instead.
    try {
      await this.webhooks.dispatch(merchantId, 'payment.refunded', {
        paymentId: payment.id,
        reference: payment.reference,
        refundAmountUsd,
        refundTxHash: txHash,
        reason: dto.reason,
      });
    } catch (err) {
      this.logger.error(
        `Refund webhook dispatch failed for payment ${payment.id} (refund already completed): ${err.message}`,
      );
    }

    try {
      await this.notifications.enqueueEmail({
        recipient: merchant.email,
        subject: `Refund processed: ${payment.reference}`,
        html: `<p>A refund of $${refundAmountUsd} has been processed for payment ${payment.reference}.</p><p>Reason: ${dto.reason}</p>`,
      });

      if (payment.customerEmail) {
        await this.notifications.enqueueEmail({
          recipient: payment.customerEmail,
          subject: `Refund received from ${merchant.businessName}`,
          html: `<p>A refund of $${refundAmountUsd} has been processed for your payment ${payment.reference}.</p><p>The funds have been sent back to your Stellar wallet.</p>`,
        });
      }
    } catch (err) {
      this.logger.error(
        `Refund notification email failed for payment ${payment.id} (refund already completed): ${err.message}`,
      );
    }

    return payment;
  }
}
