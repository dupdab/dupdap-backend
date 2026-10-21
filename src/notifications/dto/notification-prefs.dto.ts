import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';
import { NotificationChannel, NotificationEventType } from '../entities/notification-preference.entity';

export class NotificationPrefItemDto {
  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty({ enum: NotificationEventType })
  @IsEnum(NotificationEventType)
  eventType: NotificationEventType;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class UpdateNotificationPrefsDto {
  @ApiProperty({ type: [NotificationPrefItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationPrefItemDto)
  preferences: NotificationPrefItemDto[];

  @ApiPropertyOptional({ description: 'SMS destination in E.164 format (e.g. +14155550123). Required before enabling sms.' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: 'phoneNumber must be in E.164 format' })
  phoneNumber?: string;
}

export class NotificationPrefResponseItemDto {
  @ApiProperty({ enum: NotificationChannel })
  channel: NotificationChannel;

  @ApiProperty({ enum: NotificationEventType })
  eventType: NotificationEventType;

  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'in_app channel is always enabled and cannot be disabled' })
  readonly?: boolean;
}

export class NotificationPrefsResponseDto {
  @ApiProperty({ type: [NotificationPrefResponseItemDto] })
  preferences: NotificationPrefResponseItemDto[];

  @ApiPropertyOptional({ nullable: true, description: 'SMS destination in E.164 format, or null when unset' })
  phoneNumber: string | null;
}
