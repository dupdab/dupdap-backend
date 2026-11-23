import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as QRCode from 'qrcode';
import { Payment, PaymentNetwork, PaymentStatus } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import {
  BatchCreatePaymentDto,
  BatchPaymentItemDto,
  BatchPaymentResultDto,
} from './dto/batch-create-payment.dto';
import { StellarService } from '../stellar/stellar.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MerchantsService } from '../merchants/merchants.service';

const DEFAULT_EXPIRY_MINUTES = 30;
const MAX_EXPIRY_MINUTES = 1440;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly stellar: StellarService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly merchants: MerchantsService,
  ) {}

  async create(merchantId: string, dto: CreatePaymentDto): Promise<Payment> {
    const payment = await this.buildPayment(merchantId, dto);
    const saved = await this.paymentRepository.save(payment);
    this.logger.log(`PaymentCreated ${saved.reference} for merchant ${merchantId}`);
    return saved;
  }

  async createBatch(merchantId: string, dto: BatchCreatePaymentDto): Promise<BatchPaymentResultDto> {
    const items = dto?.payments ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('payments must contain at least one item');
    }

    // Validate the whole batch before persisting anything so it stays atomic.
    items.forEach((item, index) => this.validateBatchItem(item, index));

    const payments = await Promise.all(
      items.map((item) => this.buildPayment(merchantId, item)),
    );

    const saved = await this.paymentRepository.save(payments);

    for (const payment of saved) {
      this.logger.log(`PaymentCreated ${payment.reference} for merchant ${merchantId}`);
    }

    return {
      paymentIds: saved.map((payment) => payment.id),
      count: saved.length,
      items: saved.map((payment) => ({
        paymentId: payment.id,
        reference: payment.reference,
        stellarUri: this.buildStellarUri(payment),
        qrCode: payment.qrCode,
      })),
    };
  }

  async findAll(merchantId: string, page = 1, limit = 20): Promise<{ data: Payment[]; total: number }> {
    const [data, total] = await this.paymentRepository.findAndCount({
      where: { merchantId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  async getStats(merchantId: string): Promise<Record<string, number>> {
    const rows = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('payment.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('payment.merchantId = :merchantId', { merchantId })
      .groupBy('payment.status')
      .getRawMany<{ status: string; count: string }>();

    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});
  }

  async findOne(id: string, merchantId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { id, merchantId } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }

  async findByReference(reference: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { reference } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }

  async refund(id: string, merchantId: string, dto: RefundPaymentDto): Promise<Payment> {
    const payment = await this.findOne(id, merchantId);
    if (payment.status !== PaymentStatus.SETTLED) {
      throw new BadRequestException('Only settled payments can be refunded');
    }
    payment.status = PaymentStatus.REFUNDED;
    payment.refundReason = dto.reason;
    payment.refundAmountUsd = String(dto.amountUsd ?? payment.amountUsd);
    return this.paymentRepository.save(payment);
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

  private async buildPayment(
    merchantId: string,
    dto: CreatePaymentDto | BatchPaymentItemDto,
  ): Promise<Payment> {
    const reference = `PAY-${uuidv4().slice(0, 8).toUpperCase()}`;
    const depositAddress = this.stellar.getDepositAddress();
    const memo = this.stellar.generateMemo();
    const expiryMinutes = Math.min(
      dto.expiryMinutes ?? DEFAULT_EXPIRY_MINUTES,
      MAX_EXPIRY_MINUTES,
    );
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const payment = this.paymentRepository.create({
      reference,
      merchantId,
      amountUsd: String(dto.amountUsd),
      network: PaymentNetwork.STELLAR,
      status: PaymentStatus.PENDING,
      stellarDepositAddress: depositAddress,
      stellarMemo: memo,
      description: dto.memo,
      customerEmail: dto.customerEmail,
      metadata: dto.metadata,
      expiresAt,
    });

    payment.qrCode = await this.generateQrCode(payment);

    return payment;
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
