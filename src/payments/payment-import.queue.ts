import { Processor, Process } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PaymentsService } from './payments.service';
import { EmailService } from '../email/email.service';

export const PAYMENT_IMPORT_QUEUE = 'payment-imports';

export interface PaymentImportRow {
  row: number;
  reference?: string;
  amountUsd: number;
  description: string;
  customerEmail?: string;
  expiryMinutes?: number;
  metadata?: Record<string, unknown>;
}

export interface PaymentImportJob {
  merchantId: string;
  email: string;
  rows: PaymentImportRow[];
  skipped: Array<{ row: number; reason: string }>;
}

@Injectable()
@Processor(PAYMENT_IMPORT_QUEUE)
export class PaymentImportProcessor {
  private readonly logger = new Logger(PaymentImportProcessor.name);
  constructor(
    private readonly payments: PaymentsService,
    private readonly email: EmailService,
  ) {}

  @Process()
  async process(job: Job<PaymentImportJob>): Promise<void> {
    const { merchantId, email, rows } = job.data;
    const results = [...job.data.skipped];
    for (const row of rows) {
      try {
        const payment = await this.payments.create(merchantId, row);
        results.push({
          row: row.row,
          reference: payment.reference,
          status: 'created',
        } as any);
      } catch (error) {
        results.push({
          row: row.row,
          reason: error instanceof Error ? error.message : 'Payment creation failed',
        });
      }
    }
    await this.email.queue(
      email,
      'payment-import-results',
      {
        subject: 'Payment import results',
        createdCount: results.filter((result: any) => result.status === 'created').length,
        errorCount: results.filter((result: any) => result.reason).length,
        results,
      },
      merchantId,
    );
    this.logger.log(`Payment import completed job=${job.id} merchant=${merchantId} rows=${results.length}`);
  }
}
