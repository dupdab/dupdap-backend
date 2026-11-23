import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Headers,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { QueryAdminPaymentsDto } from './dto/query-admin-payments.dto';
import { UpdateFeeDto } from './dto/update-fee.dto';
import { TopMerchantsQueryDto } from '../analytics/dto/top-merchants-query.dto';
import { TopMerchantsResponseDto } from './dto/top-merchants-response.dto';
import { Request, Response } from 'express';
import { AdminService } from './admin.service';
import { RatesService } from '../rates/rates.service';
import { MerchantStatus, MerchantRole } from '../merchants/entities/merchant.entity';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { IpAllowlistGuard } from '../security/ip-allowlist.guard';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AdminTwoFactorGuard } from '../auth/guards/admin-two-factor.guard';

const EXPORT_DAILY_LIMIT = Number(process.env.ANALYTICS_EXPORT_DAILY_LIMIT ?? 5);
const EXPORT_SYNC_MAX_DAYS = 30;
const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(IpAllowlistGuard, JwtAuthGuard, AdminTwoFactorGuard, RolesGuard)
@Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
@Controller('admin')
export class AdminController {
  private readonly exportCounters = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly adminService: AdminService,
    private readonly ratesService: RatesService,
  ) {}

  @Get('merchants')
  @ApiOperation({ summary: 'List all merchants (paginated)' })
  findAllMerchants(@Query() pagination: PaginationDto) {
    const page = pagination.page ?? 1;
    const limit = Math.min(pagination.limit ?? 20, 100);
    return this.adminService.findAllMerchants(page, limit);
  }

  @Get('merchants/:id')
  @ApiOperation({ summary: 'Get merchant details' })
  findOneMerchant(@Param('id') id: string) {
    return this.adminService.findOneMerchant(id);
  }

  @Patch('merchants/:id/status')
  @Auditable({ action: 'MERCHANT_STATUS_UPDATED', resource: 'merchant' })
  @ApiOperation({ summary: 'Update merchant status' })
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: MerchantStatus,
    @Req() req: Request & { user: { id: string; merchantId?: string } },
  ) {
    return this.adminService.updateMerchantStatus(id, status, req.user?.id ?? req.user?.merchantId);
  }

  @Patch('merchants/bulk/status')
  @Auditable({ action: 'MERCHANT_STATUS_BULK_UPDATED', resource: 'merchant' })
  @ApiOperation({ summary: 'Bulk update merchant status' })
  bulkUpdateStatus(
    @Body('ids') ids: string[],
    @Body('status') status: MerchantStatus,
    @Req() req: Request & { user: { id: string; merchantId?: string } },
  ) {
    return this.adminService.bulkUpdateMerchantStatus(ids, status, req.user?.id ?? req.user?.merchantId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get global stats' })
  getStats() {
    return this.adminService.getGlobalStats();
  }

  @Get('fees')
  @ApiOperation({ summary: 'List all global fee configurations' })
  getFees() {
    return this.adminService.getGlobalFees();
  }

  @Patch('fees')
  @Auditable({ action: 'FEE_UPDATED', resource: 'fee_config' })
  @ApiOperation({ summary: 'Update a global fee rate' })
  updateFee(
    @Body() dto: UpdateFeeDto,
    @Req() req: Request & { user: { id: string; merchantId?: string } },
  ) {
    return this.adminService.updateGlobalFee(
      dto.feeType,
      dto.newRate,
      req.user.id ?? req.user?.merchantId ?? 'system',
      dto.reason,
    );
  }

  // ── Cache Management ──────────────────────────────────────────────────────

  @Post('cache/rates/refresh')
  @ApiOperation({ summary: 'Force-refresh the XLM/USD exchange rate cache' })
  async refreshRateCache() {
    const rate = await this.ratesService.fetchAndCache();
    return { rate };
  }

  @Post('cache/flush')
  @ApiOperation({ summary: 'Flush application caches (analytics, exchange rates, fee config)' })
  flushCache() {
    return this.adminService.flushCache();
  }

  // ── Geographic Distribution Analytics (#714) ───────────────────────────────

  @Get('analytics/geography')
  @ApiOperation({ summary: 'Get geographic distribution of merchants and payments' })
  getGeographicDistribution(@Query('sortBy') sortBy = 'volume') {
    return this.adminService.getGeographicDistribution(sortBy);
  }

  @Get('analytics/live')
  @ApiOperation({ summary: 'Get real-time dashboard counters (max age: 60s)' })
  getLiveAnalytics() {
    return this.adminService.getLiveAnalytics();
  }

  @Get('analytics/top-merchants')
  @ApiOperation({
    summary: 'Get top merchants ranked by settled payment volume',
    description:
      'Returns merchants ranked by total settled USD volume for the given period. ' +
      'Supports cursor-based pagination — pass the `nextCursor` from the previous ' +
      'response as the `cursor` query parameter to get the next page. ' +
      'The `limit` parameter defaults to 20 and is capped at 100.',
  })
  @ApiResponse({ status: 200, type: TopMerchantsResponseDto })
  getTopMerchants(@Query() query: TopMerchantsQueryDto): Promise<TopMerchantsResponseDto> {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    return this.adminService.getTopMerchants({ ...query, limit });
  }

  // ── Analytics Export (#905) ────────────────────────────────────────────────

  @Get('analytics/export')
  @ApiOperation({
    summary: 'Export analytics data',
    description:
      'Rate limited to a configurable number of exports per merchant per day ' +
      '(ANALYTICS_EXPORT_DAILY_LIMIT, default 5). Ranges longer than 30 days are ' +
      'queued as a background job. Returns 429 with Retry-After when the limit is exceeded.',
  })
  @ApiResponse({ status: 200, description: 'Export data or queued job reference' })
  @ApiResponse({ status: 429, description: 'Daily export limit exceeded' })
  async exportAnalytics(
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: Request & { user: { id: string; merchantId?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const merchantId = req.user?.merchantId ?? req.user?.id ?? 'anonymous';
    const now = Date.now();
    const counter = this.exportCounters.get(merchantId);

    if (!counter || now - counter.windowStart >= EXPORT_WINDOW_MS) {
      this.exportCounters.set(merchantId, { count: 1, windowStart: now });
    } else if (counter.count >= EXPORT_DAILY_LIMIT) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((counter.windowStart + EXPORT_WINDOW_MS - now) / 1000),
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Analytics export limit of ${EXPORT_DAILY_LIMIT} per day exceeded`,
          retryAfter: retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    } else {
      counter.count += 1;
    }

    const rangeDays = this.computeRangeDays(from, to);
    if (rangeDays > EXPORT_SYNC_MAX_DAYS) {
      const job = await this.adminService.queueAnalyticsExport(merchantId, from, to);
      return { status: 'queued', jobId: job?.id ?? null, from, to };
    }

    return this.adminService.exportAnalytics(merchantId, from, to);
  }

  private computeRangeDays(from?: string, to?: string): number {
    if (!from || !to) return 0;
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
    return Math.ceil((end - start) / (24 * 60 * 60 * 1000));
  }

  // ── Admin User Management with 2FA (#707) ──────────────────────────────────

  @Post('users')
  @ApiOperation({ summary: 'Create a new admin user (SUPERADMIN only)' })
  createAdmin(
    @Body() dto: { email: string; password: string; businessName: string },
    @Req() req: Request & { user: { id: string; merchantId?: string; role: MerchantRole } },
  ) {
    return this.adminService.createAdmin(
      dto.email,
      dto.password,
      dto.businessName,
      req.user.role,
      req.user?.id ?? req.user?.merchantId,
    );
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Delete an admin user (SUPERADMIN only)' })
  deleteAdmin(
    @Param('id') id: string,
    @Req() req: Request & { user: { id: string; merchantId?: string; role: MerchantRole } },
  ) {
    return this.adminService.deleteAdmin(id, req.user.role, req.user?.id ?? req.user?.merchantId);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Update an admin user role (SUPERADMIN only)' })
  updateAdminRole(
    @Param('id') id: string,
    @Body('role') role: MerchantRole,
    @Req() req: Request & { user: { id: string; merchantId: string; role: MerchantRole } },
  ) {
    return this.adminService.updateAdminRole(id, role, req.user.role, req.user.id ?? req.user.merchantId);
  }

  @Post('users/:id/2fa/setup')
  @ApiOperation({ summary: 'Generate a TOTP secret for an admin user' })
  setupAdminTotp(@Param('id') id: string) {
    return this.adminService.setupAdminTotp(id);
  }

  @Post('users/:id/2fa/verify')
  @ApiOperation({ summary: 'Verify a TOTP token and enable 2FA for an admin user' })
  verifyAdminTotp(
    @Param('id') id: string,
    @Body('token') token: string,
  ) {
    return this.adminService.verifyAdminTotp(id, token);
  }

  @Patch('users/:id/allowed-ips')
  @ApiOperation({ summary: 'Update the IP allowlist for an admin user' })
  updateAdminAllowedIps(
    @Param('id') id: string,
    @Body('ips') ips: string[],
  ) {
    return this.adminService.updateAdminAllowedIps(id, ips);
  }

  // ── Sandbox Environment Management (#708) ──────────────────────────────────

  @Patch('merchants/:id/sandbox')
  @Auditable({ action: 'SANDBOX_MODE_TOGGLED', resource: 'merchant' })
  @ApiOperation({ summary: 'Enable or disable sandbox mode for a merchant' })
  toggleSandboxMode(
    @Param('id') id: string,
    @Body('enabled') enabled: boolean,
    @Req() req: Request & { user: { id: string; merchantId?: string } },
  ) {
    return this.adminService.toggleSandboxMode(id, enabled, req.user?.id ?? req.user?.merchantId);
  }

  @Post('merchants/:id/sandbox/reset')
  @Auditable({ action: 'DATA_PURGED', resource: 'merchant' })
  @ApiOperation({ summary: 'Delete all sandbox payment data for a merchant' })
  resetSandboxData(
    @Param('id') id: string,
    @Req() req: Request & { user: { id: string; merchantId?: string } },
  ) {
    return this.adminService.resetSandboxData(id, req.user?.id ?? req.user?.merchantId);
  }
}
