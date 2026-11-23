import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus } from '../entities/payment.entity';

export class PaymentStatsDto {
  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty()
  count: number;

  @ApiProperty({ description: 'Sum of amountUsd for this status' })
  totalUsd: number;
}
