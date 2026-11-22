import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { WebhooksService } from './webhooks.service';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://example.com/hooks/payments' })
  @IsUrl()
  url: string;

  @ApiProperty({
    example: ['payment.completed', 'payment.*'],
    description:
      'Event subscriptions. Each entry is matched against the emitted event name. ' +
      'An exact name (e.g. `payment.completed`) matches only that event. ' +
      'A glob pattern using `*` matches any sequence of characters (e.g. `payment.*` ' +
      'matches `payment.completed`, `payment.failed`, etc.; `*` alone matches every event).',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  events: string[];

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateWebhookDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiProperty({
    required: false,
    example: ['payment.*'],
    description:
      'Event subscriptions. Exact names match only that event; glob patterns with `*` ' +
      'match any sequence of characters (e.g. `payment.*`).',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('webhooks')
@ApiOperation({
  summary: 'Manage webhook subscriptions',
  description:
    'Webhook event subscriptions support exact matching and glob-style patterns. ' +
    'An entry without `*` matches only the identical event name. An entry containing ' +
    '`*` is treated as a glob where `*` matches any sequence of characters ' +
    '(e.g. `payment.*` matches `payment.completed` and `payment.failed`).',
})
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  @ApiOperation({ summary: 'List webhooks' })
  findAll() {
    return this.webhooksService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Create a webhook subscription' })
  create(@Body() dto: CreateWebhookDto) {
    return this.webhooksService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a webhook subscription' })
  update(@Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.webhooksService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  remove(@Param('id') id: string) {
    return this.webhooksService.remove(id);
  }
}
