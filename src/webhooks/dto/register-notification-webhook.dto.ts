import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterNotificationWebhookDto {
  @ApiProperty({ example: 'https://example.com/webhooks/dupdub-notifications' })
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @Transform(({ value }) => value?.trim())
  url!: string;

  @ApiPropertyOptional({
    description: 'Webhook secret used to sign payloads; generated when omitted',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  secret?: string;
}
