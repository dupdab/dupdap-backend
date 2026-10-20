import { IsNotEmpty, IsOptional, IsNumber, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefundPaymentDto {
  @ApiPropertyOptional({
    description: 'Amount to refund in USD. Partial refunds are supported and may be repeated until the payment is fully refunded. If not provided, the remaining refundable balance will be refunded.',
    example: 10.50,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amountUsd?: number;

  @ApiProperty({
    description: 'Reason for the refund',
    example: 'Customer requested a return',
  })
  @IsNotEmpty()
  @IsString()
  reason: string;
}
