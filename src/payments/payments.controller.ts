import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  UseFilters,
  Request,
  UseInterceptors,
  ParseUUIDPipe,
  UploadedFile,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiResponse,
  ApiParam,
  ApiSecurity,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { BatchCreatePaymentDto, BatchPaymentResultDto } from './dto/batch-create-payment.dto';
import { PublicPaymentViewDto } from './dto/public-payment-view.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { TransactionLimitFilter } from './transaction-limit.filter';
import { parseCsv } from './payment-import.csv';
import { PAYMENT_IMPORT_QUEUE, PaymentImportJob, PaymentImportRow } from './payment-import.queue';

@ApiTags('payments')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@UseFilters(TransactionLimitFilter)
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Optional()
    @InjectQueue(PAYMENT_IMPORT_QUEUE)
    private readonly importQueue?: Queue<PaymentImportJob>,
  ) {}

  @Post('import')
  @Scopes('payments:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Import up to 500 payments from CSV' })
  async importCsv(
    @Request() req: { user: { merchantId: string; email: string } },
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file || !file.buffer) throw new BadRequestException('A CSV file is required in the file field');
    let table: string[][];
    try {
      table = parseCsv(file.buffer.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid CSV');
    }
    if (table.length < 1) throw new BadRequestException('CSV must contain a header row');
    const headers = table[0].map((header) => header.trim());
    const required = ['amount', 'description'];
    if (required.some((header) => !headers.includes(header)))
      throw new BadRequestException(`CSV must include columns: ${required.join(', ')}`);
    const referenceIndex = headers.indexOf('reference');
    const rows = table.slice(1);
    if (rows.length > 500) throw new BadRequestException('CSV may contain at most 500 data rows');

    const valid: PaymentImportRow[] = [];
    const errors: Array<{ row: number; reason: string }> = [];
    const skipped: Array<{ row: number; reason: string }> = [];
    const seen = new Set<string>();
    for (const [index, values] of rows.entries()) {
      const rowNumber = index + 2;
      const get = (name: string) => values[headers.indexOf(name)]?.trim() ?? '';
      const amountUsd = Number(get('amount'));
      const description = get('description');
      const reference = referenceIndex >= 0 ? values[referenceIndex]?.trim() : undefined;
      let metadata: Record<string, unknown> | undefined;
      const metadataText = get('metadata');
      try {
        if (metadataText) {
          metadata = JSON.parse(metadataText);
          if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error();
        }
      } catch {
        errors.push({
          row: rowNumber,
          reason: 'metadata must be a JSON object',
        });
        continue;
      }
      if (metadata && Buffer.byteLength(JSON.stringify(metadata), 'utf8') > 4096) {
        errors.push({
          row: rowNumber,
          reason: 'metadata must not exceed 4096 bytes',
        });
        continue;
      }
      const customerEmail = get('customerEmail') || undefined;
      const expiryMinutes = get('expiryMinutes') ? Number(get('expiryMinutes')) : undefined;
      if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 1_000_000)
        errors.push({
          row: rowNumber,
          reason: 'amount must be greater than 0 and at most 1000000',
        });
      else if (!description) errors.push({ row: rowNumber, reason: 'description is required' });
      else if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))
        errors.push({ row: rowNumber, reason: 'customerEmail is invalid' });
      else if (
        expiryMinutes !== undefined &&
        (!Number.isInteger(expiryMinutes) || expiryMinutes < 1 || expiryMinutes > 1440)
      )
        errors.push({
          row: rowNumber,
          reason: 'expiryMinutes must be an integer from 1 to 1440',
        });
      else if (reference && seen.has(reference))
        skipped.push({
          row: rowNumber,
          reason: 'duplicate reference in CSV; skipped',
        });
      else {
        if (reference) seen.add(reference);
        valid.push({
          row: rowNumber,
          reference,
          amountUsd,
          description,
          customerEmail,
          expiryMinutes,
          metadata,
        });
      }
    }
    const alreadyCreated: PaymentImportRow[] = [];
    for (const row of valid) {
      if (row.reference && (await this.paymentsService.hasReference(row.reference))) {
        skipped.push({
          row: row.row,
          reason: 'reference already exists; skipped',
        });
      } else alreadyCreated.push(row);
    }
    if (!this.importQueue) throw new BadRequestException('Payment import queue is unavailable');
    const job = await this.importQueue.add(
      {
        merchantId: req.user.merchantId,
        email: req.user.email,
        rows: alreadyCreated,
        skipped: [...skipped, ...errors],
      },
      { removeOnComplete: true, removeOnFail: false },
    );
    return { jobId: job.id, accepted: alreadyCreated.length, errors, skipped };
  }

  @Post()
  @Scopes('payments:write')
  @UseInterceptors(IdempotencyInterceptor)
  @Auditable({ action: 'PAYMENT_CREATED', resource: 'payment' })
  @ApiOperation({ summary: 'Create a payment request' })
  @ApiOkResponse({ description: 'Payment created' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:write scope' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  create(@Request() req: { user: { merchantId: string } }, @Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(req.user.merchantId, dto);
  }

  @Post('batch')
  @Scopes('payments:write')
  @UseInterceptors(IdempotencyInterceptor)
  @Auditable({ action: 'PAYMENT_BATCH_CREATED', resource: 'payment' })
  @ApiOperation({
    summary: 'Create up to 20 payment requests in a single contract invocation',
    description:
      'Mirrors the Soroban contract create_batch(). All inputs are validated before ' +
      'any payment is written — the entire batch reverts if any single entry is invalid.',
  })
  @ApiOkResponse({
    type: BatchPaymentResultDto,
    description: 'IDs of all created payments',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:write scope' })
  @ApiBadRequestResponse({
    description: 'Validation failed — entire batch rejected',
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  createBatch(
    @Request() req: { user: { merchantId: string } },
    @Body() dto: BatchCreatePaymentDto,
  ): Promise<BatchPaymentResultDto> {
    return this.paymentsService.createBatch(req.user.merchantId, dto);
  }

  @Get()
  @Scopes('payments:read')
  @ApiOperation({ summary: 'List all payments' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Paginated payments' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:read scope' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  findAll(
    @Request() req: { user: { merchantId: string } },
    @Query()
    query: PaginationDto & {
      reference?: string;
      memo?: string;
      [key: string]: any;
    },
  ) {
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      const match = /^metadata\[([^\]]+)\]$/.exec(key);
      if (match && typeof value === 'string') metadata[match[1]] = value;
    }
    const nestedMetadata = (query as any).metadata;
    if (nestedMetadata && typeof nestedMetadata === 'object' && !Array.isArray(nestedMetadata)) {
      for (const [key, value] of Object.entries(nestedMetadata)) {
        if (typeof value === 'string') metadata[key] = value;
      }
    }
    return this.paymentsService.findAll(req.user.merchantId, query.page, query.limit, {
      reference: query.reference,
      memo: query.memo,
      metadata,
    });
  }

  @Get('stats')
  @Scopes('payments:read')
  @ApiOperation({ summary: 'Payment statistics' })
  @ApiOkResponse({ description: 'Aggregated stats' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:read scope' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getStats(@Request() req: { user: { merchantId: string } }) {
    return this.paymentsService.getStats(req.user.merchantId);
  }

  @Get(':id/history')
  @Scopes('payments:read')
  @ApiOperation({ summary: 'Get immutable payment status history' })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  @ApiOkResponse({ description: 'Event log ordered by timestamp' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  getHistory(@Request() req: { user: { merchantId: string } }, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.getHistory(id, req.user.merchantId);
  }

  @Get(':id')
  @Scopes('payments:read')
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  @ApiOkResponse({ description: 'Payment detail' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:read scope' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  findOne(@Request() req: { user: { merchantId: string } }, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.findOne(id, req.user.merchantId);
  }

  @Post(':id/refund')
  @Scopes('payments:write')
  @Auditable({ action: 'PAYMENT_REFUNDED', resource: 'payment' })
  @ApiOperation({ summary: 'Initiate a refund for a settled payment' })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  @ApiOkResponse({ description: 'Refund successful' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:write scope' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  @ApiBadRequestResponse({ description: 'Refund not possible' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  refund(
    @Request() req: { user: { merchantId: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
  ) {
    return this.paymentsService.refund(id, req.user.merchantId, dto);
  }
}

@ApiTags('payments')
@Controller('pay')
export class PublicPaymentController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(':reference')
  @ApiOperation({ summary: 'Get payment details by reference (public)' })
  @ApiParam({ name: 'reference', example: 'PAY-abc123' })
  @ApiOkResponse({
    type: PublicPaymentViewDto,
    description: 'Public payment view',
  })
  @ApiNotFoundResponse({ description: 'Unknown reference' })
  @ApiResponse({ status: 410, description: 'QR code expired' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getByReference(@Param('reference') reference: string): Promise<PublicPaymentViewDto> {
    const payment = await this.paymentsService.findByReference(reference);
    return PublicPaymentViewDto.from(payment);
  }
}
