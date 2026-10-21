import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class HoldPaymentDto {
  @ApiProperty({
    description: 'Reason the payment is being held for review (e.g. suspected fraud)',
    example: 'Velocity check flagged for manual fraud review',
  })
  @IsNotEmpty()
  @IsString()
  reason: string;
}
