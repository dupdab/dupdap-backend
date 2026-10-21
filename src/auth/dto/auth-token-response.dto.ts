import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({
    type: [String],
    description: 'One-time recovery codes. Returned only on registration; they cannot be shown again.',
  })
  recoveryCodes?: string[];

  @ApiProperty({ description: 'Number of unread in-app notifications for the merchant' })
  unreadNotificationCount!: number;
}
