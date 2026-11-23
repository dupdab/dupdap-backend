import { ApiProperty } from '@nestjs/swagger';

export class RevenueResponseDto {
  @ApiProperty({ description: 'Total platform revenue in USD' })
  totalRevenueUsd: number;

  @ApiProperty({ description: 'Total settlement fee amounts in USD' })
  feeUsd: number;

  @ApiProperty({
    description:
      'Fee amounts in USD for REFUNDED and PARTIALLY_REFUNDED payment settlements (subtracted from revenue)',
  })
  refundedFeeUsd: number;

  @ApiProperty({ description: 'Number of settlements included in revenue' })
  settlementCount: number;
}
