import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumberString, IsOptional, IsString } from 'class-validator';
import { FeeType } from '../../fee-config/entities/fee-config.entity';

export class UpdateFeeDto {
  @ApiProperty({ enum: FeeType })
  @IsEnum(FeeType)
  feeType!: FeeType;

  @ApiProperty({ example: '0.010000', description: 'New base fee rate as a decimal string' })
  @IsNumberString()
  newRate!: string;

  @ApiPropertyOptional({ description: 'Optional reason recorded in fee history' })
  @IsOptional()
  @IsString()
  reason?: string;
}
