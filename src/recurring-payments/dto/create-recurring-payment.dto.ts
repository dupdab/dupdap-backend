import { IsNumber, IsPositive, IsInt, Min, Max, IsString, IsOptional, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const MAX_AMOUNT_USD = 1_000_000;
const MAX_INTERVAL_DAYS = 365;

export class CreateRecurringPaymentDto {
  @ApiProperty({ example: 25.0 })
  @IsNumber()
  @IsPositive()
  @Max(MAX_AMOUNT_USD)
  amountUsd: number;

  @ApiProperty({ example: 30, description: 'Days between charges (1–365)' })
  @IsInt()
  @Min(1)
  @Max(MAX_INTERVAL_DAYS)
  intervalDays: number;

  @ApiPropertyOptional({ example: 'Monthly plan' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  description?: string;

  @ApiPropertyOptional({ description: 'First charge time (ISO 8601). Defaults to now.' })
  @IsOptional()
  @IsDateString()
  startAt?: string;
}
