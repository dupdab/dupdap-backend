import { ApiProperty } from '@nestjs/swagger';
import { Merchant } from '../../merchants/entities/merchant.entity';

export class AuthTokenResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Merchant profile (password/key hashes and totpSecret stripped via @Exclude)',
  })
  merchant!: Merchant;
}
