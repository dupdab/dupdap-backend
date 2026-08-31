import { IsNumber, IsPositive, IsString, IsOptional, IsEmail, IsObject, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaxJsonSize } from '../../common/decorators/max-json-size.decorator';

const MAX_AMOUNT_USD = 1_000_000;
const MAX_METADATA_BYTES = 4096;

export class CreatePaymentDto {
  @ApiProperty({ example: 50.0 })
  @IsNumber()
  @IsPositive()
  @Max(MAX_AMOUNT_USD)
  amountUsd: number;

  @ApiPropertyOptional({ example: 'Payment for order #123' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  description?: string;

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
  expiryMinutes?: number;
}
