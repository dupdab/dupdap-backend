import { Type } from 'class-transformer';
import { IsArray, IsNumber, Max, Min, ValidateNested } from 'class-validator';

export class MerchantFeeTierItemDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumVolumeUsd: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  feeRate: number;
}

export class UpdateMerchantFeeTiersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MerchantFeeTierItemDto)
  tiers: MerchantFeeTierItemDto[];
}
