import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { AnalyticsExportFormat } from './entities/analytics-export.entity';
import { AnalyticsExportService } from './analytics-export.service';

@ApiTags('analytics')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsExportController {
  constructor(private readonly analyticsExportService: AnalyticsExportService) {}

  @Post('export')
  @Scopes('analytics:read')
  @ApiOperation({ summary: 'Queue an analytics export' })
  @ApiQuery({ name: 'format', required: false, enum: ['pdf', 'csv', 'json'] })
  @ApiQuery({ name: 'period', required: false, enum: ['daily', 'monthly'] })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Start date in YYYY-MM-DD format' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'End date in YYYY-MM-DD format' })
  @ApiOkResponse({ description: 'Export queued successfully' })
  @ApiResponse({ status: 400, description: 'Invalid export request' })
  @ApiForbiddenResponse({ description: 'API key missing analytics:read scope' })
  queueExport(
    @Req() req: Request & { user: { merchantId: string; role: MerchantRole } },
    @Query('format') format: string = AnalyticsExportFormat.PDF,
    @Query('period') period: 'daily' | 'monthly' = 'daily',
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    const deliveryBaseUrl = `${protocol}://${req.get('host')}${req.baseUrl}`;

    return this.analyticsExportService.requestExport({
      requesterId: req.user.merchantId,
      requesterRole: req.user.role,
      format,
      period,
      dateFrom,
      dateTo,
      deliveryBaseUrl,
    });
  }
}

@ApiTags('analytics')
@Controller('analytics/export')
export class AnalyticsExportDownloadController {
  constructor(private readonly analyticsExportService: AnalyticsExportService) {}

  @Get('download/:token')
  @ApiOperation({ summary: 'Download an analytics export by token' })
  @ApiOkResponse({ description: 'PDF export download' })
  @ApiResponse({ status: 404, description: 'Export not found' })
  @ApiResponse({ status: 410, description: 'Export link expired' })
  async downloadExport(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const exportRecord = await this.analyticsExportService.getDownloadByToken(token);

    const contentType = exportRecord.format === AnalyticsExportFormat.JSON
      ? 'application/json'
      : exportRecord.format === AnalyticsExportFormat.CSV ? 'text/csv' : 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportRecord.fileName ?? 'analytics-report.pdf'}"`,
    );
    res.send(exportRecord.fileData);
  }
}
