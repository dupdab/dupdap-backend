import { Controller, Post, Get, Delete, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

const DEFAULT_MAX_WEBHOOK_ENDPOINTS_PER_MERCHANT = 10;

function getMaxWebhookEndpointsPerMerchant(): number {
  const raw = process.env.MAX_WEBHOOK_ENDPOINTS_PER_MERCHANT;
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_WEBHOOK_ENDPOINTS_PER_MERCHANT;
}

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  async create(@Body() body: any) {
    const merchantId = body?.merchantId;
    if (!merchantId) {
      throw new HttpException('merchantId is required', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.webhooksService.findByMerchant(merchantId);
    const max = getMaxWebhookEndpointsPerMerchant();
    if (existing.length >= max) {
      throw new HttpException(
        `Webhook endpoint limit reached: a merchant may register at most ${max} webhook endpoints`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.webhooksService.create(body);
  }

  @Get('merchant/:merchantId')
  async listByMerchant(@Param('merchantId') merchantId: string) {
    return this.webhooksService.findByMerchant(merchantId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.webhooksService.remove(id);
  }
}
