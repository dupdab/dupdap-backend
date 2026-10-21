import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { AnalyticsExportService } from './analytics-export.service';

@Controller('merchant/analytics')
@UseGuards(JwtAuthGuard)
export class MerchantAnalyticsExportController {
  constructor(private readonly exports: AnalyticsExportService) {}

  @Get('export')
  @Scopes('analytics:read')
  export(
    @Req() req: Request & { user: { merchantId: string; role: MerchantRole } },
    @Query('format') format = 'csv',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    return this.exports.requestExport({
      requesterId: req.user.merchantId,
      requesterRole: req.user.role,
      format,
      period: 'daily',
      dateFrom: from,
      dateTo: to,
      deliveryBaseUrl: `${protocol}://${req.get('host')}/analytics`,
    });
  }
}
