import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class ReplayWebhooksDto {
  @ApiProperty({ example: '2026-10-01T00:00:00.000Z', description: 'Replay window start (ISO 8601)' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ example: '2026-10-19T00:00:00.000Z', description: 'Replay window end (ISO 8601)' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional({ example: 'payment.completed', description: 'Only replay this event type' })
  @IsOptional()
  @IsString()
  eventType?: string;
}
