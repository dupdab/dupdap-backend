import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SuspendMerchantDto {
  @ApiProperty({ example: 'AML review pending' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
