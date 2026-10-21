import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, Max } from 'class-validator';

const MAX_TRANSACTION_LIMIT_USD = 1_000_000_000;

export class UpdateTransactionLimitsDto {
  @ApiPropertyOptional({ description: 'Maximum USD value of a single payment', example: 10000 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(MAX_TRANSACTION_LIMIT_USD)
  singleTransactionLimitUsd?: number;

  @ApiPropertyOptional({ description: 'Maximum USD total of payments in a rolling 24h window', example: 100000 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(MAX_TRANSACTION_LIMIT_USD)
  dailyLimitUsd?: number;
}
