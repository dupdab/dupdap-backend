import {
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
  IsEmail,
  IsObject,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  IsNotEmpty,
  MinLength,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaxJsonSize } from '../../common/decorators/max-json-size.decorator';

const MAX_AMOUNT_USD = 1_000_000;
const MAX_METADATA_BYTES = 4096;

export class BatchPaymentItemDto {
  @ApiProperty({ example: 50.0, description: 'Amount in USD — must be greater than 0' })
  @IsNumber()
  @IsPositive()
  @Max(MAX_AMOUNT_USD)
  amountUsd: number;

  @ApiProperty({ example: 'Order #123', description: 'Non-empty memo for this payment' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @Transform(({ value }) => value?.trim())
  memo: string;

  @ApiPropertyOptional({ example: 'customer@example.com' })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => value?.trim())
  customerEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @MaxJsonSize(MAX_METADATA_BYTES, {
    message: `metadata must not exceed ${MAX_METADATA_BYTES} bytes when serialized`,
  })
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ example: 30, description: 'Expiry in minutes (default 30)' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  expiryMinutes?: number;
}

export class BatchCreatePaymentDto {
  @ApiProperty({
    type: [BatchPaymentItemDto],
    description: 'Between 1 and 20 payment requests to create atomically',
    minItems: 1,
    maxItems: 20,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BatchPaymentItemDto)
  payments: BatchPaymentItemDto[];
}

export class BatchPaymentResultDto {
  @ApiProperty({ description: 'IDs of all created payments in order' })
  paymentIds: string[];

  @ApiProperty({ description: 'Total number of payments created' })
  count: number;
}
