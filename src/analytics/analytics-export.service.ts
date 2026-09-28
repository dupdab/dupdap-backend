import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bull';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { EmailService } from '../email/email.service';
import { Merchant, MerchantRole } from '../merchants/entities/merchant.entity';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
import { Settlement, SettlementStatus } from '../settlements/entities/settlement.entity';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsExport,
  AnalyticsExportFormat,
  AnalyticsExportScope,
  AnalyticsExportStatus,
} from './entities/analytics-export.entity';

export const ANALYTICS_EXPORT_QUEUE = 'analytics-export';

type AnalyticsPeriod = 'daily' | 'monthly';

interface RequestExportOptions {
  requesterId: string;
  requesterRole: MerchantRole;
  format: string;
  period: AnalyticsPeriod;
  dateFrom?: string;
  dateTo?: string;
  deliveryBaseUrl: string;
}

interface ExportMetrics {
  period: AnalyticsPeriod;
  periodLabel: string;
  merchantName: string;
  volumeSeries: Array<{ date: string; count: number; volumeUsd: number }>;
  totalVolumeUsd: number;
  paymentCount: number;
  averagePaymentValueUsd: number;
  highestVolumeBucket: { date: string; volumeUsd: number };
  averageBucketVolumeUsd: number;
  settlementSummary: {
    count: number;
    grossUsd: number;
    netUsd: number;
    feesUsd: number;
  };
  topMetrics: Array<{ label: string; value: string }>;
}

interface TimeRange {
  start: Date;
  endExclusive: Date;
}

@Injectable()
export class AnalyticsExportService {
  private readonly logger = new Logger(AnalyticsExportService.name);

  constructor(
    @InjectRepository(AnalyticsExport)
    private readonly exportRepo: Repository<AnalyticsExport>,
    @InjectRepository(Merchant)
    private readonly merchantsRepo: Repository<Merchant>,
    @InjectRepository(Payment)
    private readonly paymentsRepo: Repository<Payment>,
    @InjectRepository(Settlement)
    private readonly settlementsRepo: Repository<Settlement>,
    @InjectQueue(ANALYTICS_EXPORT_QUEUE)
    private readonly exportQueue: Queue<{ exportId: string }>,
    private readonly analyticsService: AnalyticsService,
    private readonly emailService: EmailService,
  ) {}

  async requestExport(options: RequestExportOptions) {
    const { requesterId, requesterRole, format, period, dateFrom, dateTo, deliveryBaseUrl } =
      options;

    if (format !== AnalyticsExportFormat.PDF) {
      throw new BadRequestException('Only pdf exports are supported');
    }

    const requester = await this.merchantsRepo.findOne({ where: { id: requesterId } });
    if (!requester) {
      throw new NotFoundException('Merchant not found');
    }

    const scope =
      requesterRole === MerchantRole.ADMIN || requesterRole === MerchantRole.SUPERADMIN
        ? AnalyticsExportScope.ADMIN
        : AnalyticsExportScope.MERCHANT;

    const exportRecord = await this.exportRepo.save(
      this.exportRepo.create({
        format: AnalyticsExportFormat.PDF,
        scope,
        status: AnalyticsExportStatus.QUEUED,
        requestedByMerchantId: requester.id,
        merchantId: scope === AnalyticsExportScope.MERCHANT ? requester.id : null,
        recipientEmail: requester.email,
        merchantBusinessName: requester.businessName,
        period,
        dateFrom: dateFrom ?? null,
        dateTo: dateTo ?? null,
        deliveryBaseUrl: deliveryBaseUrl.replace(/\/$/, ''),
        fileName: null,
        fileData: null,
        downloadToken: null,
        expiresAt: null,
        errorMessage: null,
      }),
    );

    await this.exportQueue.add(
      'generate',
      { exportId: exportRecord.id },
      { removeOnComplete: true, removeOnFail: false },
    );

    return {
      exportId: exportRecord.id,
      status: exportRecord.status,
      message: 'Analytics export queued',
    };
  }

  async generateExport(exportId: string): Promise<void> {
    const exportRecord = await this.exportRepo.findOne({ where: { id: exportId } });
    if (!exportRecord) {
      this.logger.warn(`Analytics export not found: ${exportId}`);
      return;
    }

    exportRecord.status = AnalyticsExportStatus.PROCESSING;
    exportRecord.errorMessage = null;
    await this.exportRepo.save(exportRecord);

    try {
      const metrics = await this.buildMetrics(exportRecord);
      const buffer = await this.buildPdf(metrics);
      const token = randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const fileName = this.buildFileName(exportRecord, metrics);

      exportRecord.fileName = fileName;
      exportRecord.fileData = buffer;
      exportRecord.downloadToken = token;
      exportRecord.expiresAt = expiresAt;
      exportRecord.status = AnalyticsExportStatus.READY;
      await this.exportRepo.save(exportRecord);

      await this.emailService.queue(
        exportRecord.recipientEmail,
        'analytics-report-ready',
        {
          merchantName: exportRecord.merchantBusinessName,
          reportName: fileName,
          downloadUrl: `${exportRecord.deliveryBaseUrl}/export/download/${token}`,
          expiresAt: expiresAt.toISOString(),
        },
        exportRecord.requestedByMerchantId,
      );
    } catch (error) {
      exportRecord.status = AnalyticsExportStatus.FAILED;
      exportRecord.errorMessage = error instanceof Error ? error.message : String(error);
      await this.exportRepo.save(exportRecord);
      throw error;
    }
  }

  async getDownloadByToken(token: string): Promise<AnalyticsExport> {
    const exportRecord = await this.exportRepo.findOne({
      where: { downloadToken: token },
    });

    if (!exportRecord || !exportRecord.fileData || exportRecord.status !== AnalyticsExportStatus.READY) {
      throw new NotFoundException('Analytics export not found');
    }

    if (exportRecord.expiresAt && exportRecord.expiresAt.getTime() < Date.now()) {
      throw new GoneException('Download link expired');
    }

    return exportRecord;
  }

  private async buildMetrics(exportRecord: AnalyticsExport): Promise<ExportMetrics> {
    const period = exportRecord.period;
    const merchantName = exportRecord.merchantBusinessName;
    const volumeSeries = await this.analyticsService.getVolume({
      scope:
        exportRecord.scope === AnalyticsExportScope.ADMIN ? 'admin' : 'merchant',
      merchantId: exportRecord.merchantId ?? undefined,
      period,
      dateFrom: exportRecord.dateFrom ?? undefined,
      dateTo: exportRecord.dateTo ?? undefined,
    });

    const totalVolumeUsd = volumeSeries.reduce((sum, item) => sum + item.volumeUsd, 0);
    const paymentCount = volumeSeries.reduce((sum, item) => sum + item.count, 0);
    const averagePaymentValueUsd = paymentCount > 0 ? totalVolumeUsd / paymentCount : 0;
    const highestVolumeBucket = volumeSeries.reduce(
      (best, item) => (item.volumeUsd > best.volumeUsd ? item : best),
      volumeSeries[0] ?? { date: 'N/A', count: 0, volumeUsd: 0 },
    );
    const averageBucketVolumeUsd =
      volumeSeries.length > 0 ? totalVolumeUsd / volumeSeries.length : 0;

    const range = this.resolveRange(
      period,
      exportRecord.dateFrom ?? undefined,
      exportRecord.dateTo ?? undefined,
    );
    const settlementSummary = await this.getSettlementSummary(exportRecord, range);
    const periodLabel =
      volumeSeries.length > 0
        ? `${volumeSeries[0].date} to ${volumeSeries[volumeSeries.length - 1].date}`
        : `${this.formatRangeLabel(range.start, period)} to ${this.formatRangeLabel(
            this.previousMoment(range.endExclusive, period),
            period,
          )}`;

    return {
      period,
      periodLabel,
      merchantName,
      volumeSeries,
      totalVolumeUsd,
      paymentCount,
      averagePaymentValueUsd,
      highestVolumeBucket,
      averageBucketVolumeUsd,
      settlementSummary,
      topMetrics: [
        { label: 'Total volume (USD)', value: this.formatCurrency(totalVolumeUsd) },
        { label: 'Payments', value: paymentCount.toLocaleString('en-US') },
        {
          label: 'Average payment value (USD)',
          value: this.formatCurrency(averagePaymentValueUsd),
        },
        {
          label: 'Highest volume bucket',
          value: `${highestVolumeBucket.date} (${this.formatCurrency(
            highestVolumeBucket.volumeUsd,
          )})`,
        },
        {
          label: 'Average bucket volume (USD)',
          value: this.formatCurrency(averageBucketVolumeUsd),
        },
        {
          label: 'Settlements',
          value: `${settlementSummary.count.toLocaleString('en-US')} (net ${this.formatCurrency(
            settlementSummary.netUsd,
          )})`,
        },
      ],
    };
  }

  private async getSettlementSummary(
    exportRecord: AnalyticsExport,
    range: TimeRange,
  ): Promise<ExportMetrics['settlementSummary']> {
    const query = this.settlementsRepo
      .createQueryBuilder('settlement')
      .where('settlement.createdAt >= :start', { start: range.start })
      .andWhere('settlement.createdAt < :end', { end: range.endExclusive })
      .andWhere('settlement.status = :status', { status: SettlementStatus.COMPLETED });

    if (exportRecord.scope === AnalyticsExportScope.MERCHANT && exportRecord.merchantId) {
      query.andWhere('settlement.merchantId = :merchantId', {
        merchantId: exportRecord.merchantId,
      });
    }

    const settlements = await query.getMany();
    const grossUsd = settlements.reduce((sum, item) => sum + Number(item.grossAmount ?? 0), 0);
    const netUsd = settlements.reduce((sum, item) => sum + Number(item.netAmount ?? 0), 0);
    const feesUsd = settlements.reduce((sum, item) => sum + Number(item.feeAmount ?? 0), 0);

    return {
      count: settlements.length,
      grossUsd,
      netUsd,
      feesUsd,
    };
  }

  private async buildPdf(metrics: ExportMetrics): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFDocument = require('pdfkit');

    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(20).text('Analytics Report', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(12).text(`Merchant: ${metrics.merchantName}`);
        doc.text(`Period: ${metrics.periodLabel}`);
        doc.text(`Generated: ${new Date().toISOString()}`);
        doc.moveDown();

        doc.fontSize(14).text('Summary');
        doc.moveDown(0.5);
        doc.fontSize(11);
        for (const metric of metrics.topMetrics) {
          doc.text(`${metric.label}: ${metric.value}`);
        }
        doc.moveDown();

        doc.fontSize(14).text('Volume Breakdown');
        doc.moveDown(0.5);
        doc.fontSize(11);
        if (metrics.volumeSeries.length === 0) {
          doc.text('No volume data available for this period.');
        } else {
          for (const bucket of metrics.volumeSeries) {
            doc.text(
              `${bucket.date}: ${bucket.count.toLocaleString('en-US')} payments, ${this.formatCurrency(
                bucket.volumeUsd,
              )}`,
            );
          }
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private buildFileName(exportRecord: AnalyticsExport, metrics: ExportMetrics): string {
    const scopeLabel =
      exportRecord.scope === AnalyticsExportScope.ADMIN ? 'admin' : 'merchant';
    const safePeriod = metrics.periodLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `analytics-${scopeLabel}-${safePeriod || 'report'}.pdf`;
  }

  private resolveRange(
    period: AnalyticsPeriod,
    dateFrom?: string,
    dateTo?: string,
  ): TimeRange {
    const end = dateTo ? new Date(dateTo) : new Date();
    const start = dateFrom
      ? new Date(dateFrom)
      : this.previousMoment(end, period, 12);

    return {
      start,
      endExclusive: this.nextMoment(end, period),
    };
  }

  private previousMoment(date: Date, period: AnalyticsPeriod, steps = 1): Date {
    const result = new Date(date);
    if (period === 'monthly') {
      result.setUTCMonth(result.getUTCMonth() - steps);
    } else {
      result.setUTCDate(result.getUTCDate() - steps);
    }
    return result;
  }

  private nextMoment(date: Date, period: AnalyticsPeriod): Date {
    const result = new Date(date);
    if (period === 'monthly') {
      result.setUTCMonth(result.getUTCMonth() + 1);
    } else {
      result.setUTCDate(result.getUTCDate() + 1);
    }
    return result;
  }

  private formatRangeLabel(date: Date, period: AnalyticsPeriod): string {
    if (period === 'monthly') {
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    return date.toISOString().slice(0, 10);
  }

  private formatCurrency(value: number): string {
    return `$${value.toFixed(2)}`;
  }
}
