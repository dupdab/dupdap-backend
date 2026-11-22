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
import { AuditService } from '../audit/audit.service';
import { TokenBlacklistService } from '../auth/services/token-blacklist.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(IpAllowlistGuard, JwtAuthGuard, AdminTwoFactorGuard, RolesGuard)
@Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly ratesService: RatesService,
    private readonly auditService: AuditService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  @Get('merchants')
  @ApiOperation({ summary: 'List all merchants' })
  findAllMerchants(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.findAllMerchants(+page, +limit);
  }

  @Get('merchants/:id')
  @ApiOperation({ summary: 'Get merchant details' })
  findOneMerchant(@Param('id') id: string) {
    return this.adminService.findOneMerchant(id);
  }

  @Patch('merchants/:id/status')
  @Auditable({ action: 'MERCHANT_STATUS_UPDATED', resource: 'merchant' })
  @ApiOperation({ summary: 'Update merchant status' })
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: MerchantStatus,
    @Req() req: Request & { user: { id: string; merchantId?: string } },
  ) {
    const actorId = req.user?.id ?? req.user?.merchantId;
    const before = await this.adminService.findOneMerchant(id);
    const result = await this.adminService.updateMerchantStatus(id, status, actorId);
    if (status === MerchantStatus.SUSPENDED) {
      await this.tokenBlacklistService.blacklistAllForMerchant(id);
    }
    await this.auditService.log({
      actorId,
      action: 'MERCHANT_STATUS_UPDATED',
      resourceType: 'merchant',
      resourceId: id,
      before: { status: before?.status },
      after: { status },
      ip: req.ip,
    });
    return result;
  }

  @Patch('merchants/bulk/status')
  @Auditable({ action: 'MERCHANT_STATUS_BULK_UPDATED', resource: 'merchant' })
  @ApiOperation({ summary: 'Bulk update merchant status' })
  async bulkUpdateStatus(
    @Body('ids') ids: string[],
    @Body('status') status: MerchantStatus,
    @Req() req: Request & { user: { id: string; merchantId?: string } },
  ) {
    const actorId = req.user?.id ?? req.user?.merchantId;
    const result = await this.adminService.bulkUpdateMerchantStatus(ids, status, actorId);
    if (status === MerchantStatus.SUSPENDED) {
      await Promise.all(
        ids.map((merchantId) =>
          this.tokenBlacklistService.blacklistAllForMerchant(merchantId),
        ),
      );
    }
    await this.auditService.log({
      actorId,
      action: 'MERCHANT_STATUS_BULK_UPDATED',
      resourceType: 'merchant',
      resourceId: ids.join(','),
      before: null,
      after: { ids, status },
      ip: req.ip,
    });
    return result;
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
  async updateFee(
    @Body() dto: UpdateFeeDto,
    @Req() req: Request & { user: { id: string; merchantId?: string } },
  ) {
    const actorId = req.user.id ?? req.user?.merchantId ?? 'system';
    const before = await this.adminService.getGlobalFees();
    const result = await this.adminService.updateGlobalFee(
      dto.feeType,
      dto.newRate,
      actorId,
      dto.reason,
    );
    await this.auditService.log({
      actorId,
      action: 'FEE_UPDATED',
      resourceType: 'fee_config',
      resourceId: dto.feeType,
      before: { feeType: dto.feeType, rate: before?.[dto.feeType] },
      after: { feeType: dto.feeType, rate: dto.newRate, reason: dto.reason },
      ip: req.ip,
    });
    return result;
  }

  // ── Audit Log Query (#925) ─────────────────────────────────────────────────

  @Get('audit-log')
  @ApiOperation({ summary: 'Query the admin audit log with filters' })
  queryAuditLog(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.auditService.query({
      actorId,
      action,
      resourceType,
      resourceId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: +page,
      limit: +limit,
    });
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
      'response as the `cursor` query parameter to get the next page.',
  })
  @ApiResponse({ status: 200, type: TopMerchantsResponseDto })
  getTopMerchants(@Query() query: TopMerchantsQueryDto): Promise<TopMerchantsResponseDto> {
    return this.adminService.getTopMerchants(query);
  }

  // ── Admin User Management with 2FA (#707) ──────────────────────────────────

  @Post('users')
  @ApiOperation({ summary: 'Create a new admin user (SUPERADMIN only)' })
  async createAdmin(
    @Body() dto: { email: string; password: string; businessName: string },
    @Req() req: Request & { user: { id: string; merchantId?: string; role: MerchantRole } },
  ) {
    const actorId = req.user?.id ?? req.user?.merchantId;
    const result = await this.adminService.createAdmin(
      dto.email,
      dto.password,
      dto.businessName,
      req.user.role,
      actorId,
    );
    await this.auditService.log({
      actorId,
      action: 'ADMIN_USER_CREATED',
      resourceType: 'admin_user',
      resourceId: (result as { id?: string })?.id ?? dto.email,
      before: null,
      after: { email: dto.email, businessName: dto.businessName },
      ip: req.ip,
    });
    return result;
  }
}
