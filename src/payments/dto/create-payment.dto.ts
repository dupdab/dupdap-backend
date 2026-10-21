import { IsNumber, IsPositive, IsString, IsOptional, IsEmail, IsIP, IsObject, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaxJsonSize } from '../../common/decorators/max-json-size.decorator';

const MAX_AMOUNT_USD = 1_000_000;
const MAX_METADATA_BYTES = 4096;

export class CreatePaymentDto {
  @ApiPropertyOptional({ example: 'PAY-payroll-001' })
  @IsOptional()
  @IsString()
  reference?: string;

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

  @ApiPropertyOptional({ example: '203.0.113.7', description: "The customer's IP address, used for country lookup" })
  @IsOptional()
  @IsIP()
  customerIp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @MaxJsonSize(MAX_METADATA_BYTES, {
    message: `metadata must not exceed ${MAX_METADATA_BYTES} bytes when serialized`,
  })
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    example: 30,
    description: 'Expiry in minutes (default 30, max 1440)',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(1440)
  expiryMinutes?: number;
}
