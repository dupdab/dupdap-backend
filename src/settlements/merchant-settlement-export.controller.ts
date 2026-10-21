import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SettlementsService } from './settlements.service';

@Controller('merchant/settlements')
@UseGuards(JwtAuthGuard)
export class MerchantSettlementExportController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 86_400_000 } })
  async export(
    @Req() req: Request & { user: { merchantId: string } },
    @Query('format') format = 'csv',
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    if (format !== 'csv') throw new BadRequestException('Only csv settlement exports are supported');
    const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    const result = await this.settlements.requestMerchantCsvExport(
      req.user.merchantId,
      from,
      to,
      `${protocol}://${req.get('host')}/merchant/settlements`,
    );
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="settlements.csv"');
      res.send(result.csv);
    } else {
      res.status(202).json(result);
    }
  }

  @Get('export/download/:token')
  async download(@Param('token') token: string, @Res() res: Response) {
    const record = await this.settlements.getCsvExportByToken(token);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.send(record.fileData);
  }

  @Get(':id/receipt')
  async receipt(
    @Req() req: Request & { user: { merchantId: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.settlements.getReceiptPdf(req.user.merchantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="settlement-${id}.pdf"`);
    res.send(pdf);
  }
}
