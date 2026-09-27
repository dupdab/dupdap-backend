import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUrl } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://example.com/webhooks/dupdub' })
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  @Transform(({ value }) => value?.trim())
  url!: string;

  @ApiProperty({ type: [String], example: ['payment.completed'] })
  @IsArray()
  @IsString({ each: true })
  events!: string[];

  @ApiPropertyOptional({ description: 'Optional shared secret for signing' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  secret?: string;
}
