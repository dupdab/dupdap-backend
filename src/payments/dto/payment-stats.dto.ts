import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus } from '../entities/payment.entity';

  @ApiProperty({ example: 2, description: 'Number of payments with this status' })
  count: number;

  @ApiProperty({ example: 150.0, description: 'Sum of amountUsd for this status' })
  totalUsd: number;

  static from(raw: { status: PaymentStatus; count: string | number; totalUsd: string | number | null }): PaymentStatsDto {
    const dto = new PaymentStatsDto();
    dto.status = raw.
export class PaymentStatsDto {
  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty({ example: 2, description: 'Number of payments with this status' })
  count: number;

  @ApiProperty({ example: 150.0, description: 'Sum of amountUsd for this status' })
  totalUsd: number;

  static from(raw: { status: PaymentStatus; count: string | number; totalUsd: string | number | null }): PaymentStatsDto {
    const dto = new PaymentStatsDto();
    dto.status = raw.status;
    dto.count = Number(raw.count);
    dto.totalUsd = Number(raw.totalUsd ?? 0);
    return dto;
  }
}
