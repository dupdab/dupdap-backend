import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
export class UpdateMerchantSettingsDto {
  @ApiPropertyOptional({ example: 'Yaba Electronics', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessName?: string;

  @ApiPropertyOptional({ example: 'retail' })
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({
    example: 'merchant-logos/yaba-electronics.webp',
    description: 'R2 object key for merchant logo',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  logoKey?: string | null;

  @ApiPropertyOptional({ maxLength: 300, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({ example: 'NGN' })
  @IsOptional()
  @IsString()
  settlementCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoSettleEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'USDC threshold for automatic settlement',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  threshold?: number;

  @ApiPropertyOptional({
    description: 'Custom fee rate override (e.g. 0.015 = 1.5%). Null to use global default.',
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  customFeeRate?: number;
}
