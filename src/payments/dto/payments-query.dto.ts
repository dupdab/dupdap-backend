import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query parameters for `GET /payments` (#802).
 *
 * `page` and `limit` are validated here so out-of-range values are rejected
 * with a 400 before reaching the service. `limit` is capped at 100 to prevent
 * arbitrarily large result sets.
 */
export class PaymentsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Exact payment reference' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'Exact Stellar memo' })
  @IsOptional()
  @IsString()
  memo?: string;
}
