import { ApiProperty } from '@nestjs/swagger';
import { Payment, PaymentNetwork, PaymentStatus } from '../entities/payment.entity';

/**
 * Public-safe view of a payment for the unauthenticated GET /pay/:reference page.
 * Deliberately excludes PII and internal fields (customerEmail, customerWalletAddress,
 * merchant-supplied metadata, merchantId, settlementId, fee/settlement figures, tx hashes).
 */
export class PublicPaymentViewDto {
  @ApiProperty()
  reference: string;

  @ApiProperty()
  amountUsd: number;

  @ApiProperty({ nullable: true })
  amountXlm: number | null;

  @ApiProperty({ nullable: true })
  amountUsdc: number | null;

  @ApiProperty({ nullable: true })
  currency: string | null;

  @ApiProperty({ enum: PaymentNetwork })
  network: PaymentNetwork;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty({ nullable: true })
  stellarDepositAddress: string | null;

  @ApiProperty({ nullable: true })
  stellarMemo: string | null;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true })
  qrCode: string | null;

  @ApiProperty({ nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ nullable: true })
  expiryLedger: number | null;

  @ApiProperty()
  createdAt: Date;

  static from(payment: Payment): PublicPaymentViewDto {
    const dto = new PublicPaymentViewDto();
    dto.reference = payment.reference;
    dto.amountUsd = payment.amountUsd;
    dto.amountXlm = payment.amountXlm ?? null;
    dto.amountUsdc = payment.amountUsdc ?? null;
    dto.currency = payment.currency ?? null;
    dto.network = payment.network;
    dto.status = payment.status;
    dto.stellarDepositAddress = payment.stellarDepositAddress ?? null;
    dto.stellarMemo = payment.stellarMemo ?? null;
    dto.description = payment.description ?? null;
    dto.qrCode = payment.qrCode ?? null;
    dto.expiresAt = payment.expiresAt ?? null;
    dto.expiryLedger = payment.expiryLedger ?? null;
    dto.createdAt = payment.createdAt;
    return dto;
  }
}
