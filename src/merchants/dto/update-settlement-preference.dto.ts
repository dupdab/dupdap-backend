import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SettlementFrequency } from '../entities/merchant.entity';

export class UpdateSettlementPreferenceDto {
  @ApiProperty({ enum: SettlementFrequency, example: SettlementFrequency.DAILY })
  @IsEnum(SettlementFrequency)
  settlementFrequency: SettlementFrequency;
}
