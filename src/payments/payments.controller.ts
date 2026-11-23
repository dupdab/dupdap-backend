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
  ClassSerializerInterceptor,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { PaymentStatsDto } from './dto/payment-stats.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { PaymentsQueryDto } from './dto/payments-query.dto';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { TransactionLimitFilter } from './transaction-limit.filter';
import { PaymentCreationRateLimitService } from './payment-creation-rate-limit.service';

import { maskEmail } from './dto/public-payment-view.dto';

@ApiTags('payments')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@UseFilters(TransactionLimitFilter)
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paymentCreationRateLimit: PaymentCreationRateLimitService,
  ) {}

  @Post()
  @Scopes('payments:write')
  // Serializer must sit inside IdempotencyInterceptor so cached replays hold masked bodies
  @UseInterceptors(IdempotencyInterceptor, ClassSerializerInterceptor)
  @Auditable({ action: 'PAYMENT_CREATED', resource: 'payment' })
  @ApiOperation({ summary: 'Create a payment request' })
  @ApiOkResponse({ description: 'Payment created' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:write scope' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiResponse({ status: 429, description: 'Payment creation rate limit exceeded (Retry-After header set)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async create(
    @Request() req: { user: { merchantId: string }; headers: Record<string, string | string[] | undefined> },
    @Body() dto: CreatePaymentDto,
  ) {
    await this.enforceCreationRateLimit(req);
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
  @ApiOkResponse({ type: BatchPaymentResultDto, description: 'IDs of all created payments' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:write scope' })
  @ApiBadRequestResponse({ description: 'Validation failed — entire batch rejected' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  createBatch(
    @Request() req: { user: { merchantId: string } },
    @Body() dto: BatchCreatePaymentDto,
  ): Promise<BatchPaymentResultDto> {
    return this.paymentsService.createBatch(req.user.merchantId, dto);
  }

  @Get()
  @Scopes('payments:read')
  @UseInterceptors(ClassSerializerInterceptor)
  @ApiOperation({ summary: 'List all payments' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (>= 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1-100)' })
  @ApiOkResponse({ description: 'Paginated payments' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:read scope' })
  @ApiBadRequestResponse({ description: 'Invalid pagination parameters' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  findAll(@Request() req: { user: { merchantId: string } }, @Query() pagination: PaymentsQueryDto) {
    return this.paymentsService.findAll(req.user.merchantId, pagination.page, pagination.limit);
  }

  @Get('stats')
  @Scopes('payments:read')
  @ApiOperation({ summary: 'Payment statistics' })
  @ApiOkResponse({ type: PaymentStatsDto, isArray: true, description: 'Aggregated stats' })
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
  @UseInterceptors(ClassSerializerInterceptor)
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

  @Get(':id/receipt')
  @Scopes('payments:read')
  @ApiOperation({
    summary: 'Download an HTML receipt for a payment',
    description:
      'Returns a printable HTML receipt containing the payment ID, amount, date, merchant name and status.',
  })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  @ApiOkResponse({ description: 'HTML receipt', content: { 'text/html': {} } })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:read scope' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async receipt(
    @Request() req: { user: { merchantId: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const payment = await this.paymentsService.findOne(id, req.user.merchantId);
    const merchantName = payment?.merchant?.businessName ?? payment?.merchantId ?? 'Unknown merchant';
    const amount = payment?.amountUsd ?? '0';
    const date = payment?.createdAt ? new Date(payment.createdAt).toISOString() : '';
    const status = payment?.status ?? 'unknown';
    const escape = (value: unknown) =>
      String(value ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
      );
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Receipt ${escape(payment?.id)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
h1 { font-size: 1.25rem; }
table { border-collapse: collapse; min-width: 320px; }
th, td { text-align: left; padding: 0.5rem 1rem; border-bottom: 1px solid #ddd; }
th { width: 40%; color: #555; font-weight: 600; }
</style>
</head>
<body>
<h1>Payment Receipt</h1>
<table>
<tr><th>Payment ID</th><td>${escape(payment?.id)}</td></tr>
<tr><th>Amount (USD)</th><td>${escape(amount)}</td></tr>
<tr><th>Date</th><td>${escape(date)}</td></tr>
<tr><th>Merchant</th><td>${escape(merchantName)}</td></tr>
<tr><th>Status</th><td>${escape(status)}</td></tr>
</table>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${payment?.id ?? id}.html"`);
    res.send(html);
  }

  @Post(':id/cancel')
  @Scopes('payments:write')
  @UseInterceptors(ClassSerializerInterceptor)
  @Auditable({ action: 'PAYMENT_CANCELLED', resource: 'payment' })
  @ApiOperation({ summary: 'Cancel a pending payment' })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  @ApiOkResponse({ description: 'Payment cancelled' })
  cancel(@Request() req: { user: { merchantId: string } }, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.cancel(id, req.user.merchantId);
  }

  @Post(':id/refund')
  @Scopes('payments:write')
  @UseInterceptors(ClassSerializerInterceptor)
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

  /**
   * Enforces the per-API-key payment creation rate limit (#809). Requests
   * without an API key (bearer JWT sessions) are not limited here.
   */
  private async enforceCreationRateLimit(req: {
    user: { merchantId: string };
    headers: Record<string, string | string[] | undefined>;
  }): Promise<void> {
    const rawKey = req.headers['x-api-key'];
    const apiKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) return;
    await this.paymentCreationRateLimit.checkAndIncrement(apiKey.trim());
  }
}

@ApiTags('payments')
@Controller('pay')
export class PublicPaymentController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(':reference')
  @ApiOperation({ summary: 'Get payment details by reference (public)' })
  @ApiParam({ name: 'reference', example: 'PAY-abc123' })
  @ApiOkResponse({ type: PublicPaymentViewDto, description: 'Public payment view' })
  @ApiNotFoundResponse({ description: 'Unknown reference' })
  @ApiResponse({ status: 410, description: 'QR code expired' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getByReference(@Param('reference') reference: string): Promise<PublicPaymentViewDto> {
    // Intentionally unscoped: only the unauthenticated pay page may call this. Authenticated callers must scope by merchantId (#853).
    const payment = await this.paymentsService.findByReference(reference);
    return PublicPaymentViewDto.from(payment);
  }
}
