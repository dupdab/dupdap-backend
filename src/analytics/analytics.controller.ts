import { Controller, ForbiddenException, Get, Query, UseGuards, Request } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';

@ApiTags('analytics')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('revenue')
  @Scopes('analytics:read')
  @ApiOperation({ summary: 'Get settlement fee revenue analytics' })
  @ApiQuery({ name: 'period', enum: ['daily', 'monthly'], required: false })
  @ApiQuery({ name: 'from', required: false, description: 'Start date in YYYY-MM-DD format' })
  @ApiQuery({ name: 'to', required: false, description: 'End date in YYYY-MM-DD format' })
  @ApiOkResponse({ description: 'Revenue analytics data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing analytics:read scope' })
  async getRevenue(
    @Request() req: { user: { merchantId: string; role: MerchantRole } },
    @Query('period') period: 'daily' | 'monthly' = 'daily',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const isAdmin =
      req.user.role === MerchantRole.ADMIN || req.user.role === MerchantRole.SUPERADMIN;

    return this.analyticsService.getRevenue({
      scope: isAdmin ? 'admin' : 'merchant',
      merchantId: isAdmin ? undefined : req.user.merchantId,
      period,
      from,
      to,
    });
  }

  @Get('volume')
  @Scopes('analytics:read')
  @ApiOperation({ summary: 'Get payment volume aggregation' })
  @ApiQuery({ name: 'period', enum: ['daily', 'monthly'], required: false })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Start date in YYYY-MM-DD format' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'End date in YYYY-MM-DD format' })
  @ApiOkResponse({ description: 'Volume analytics data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing analytics:read scope' })
  async getVolume(
    @Request() req: { user: { merchantId: string; role: MerchantRole } },
    @Query('period') period: 'daily' | 'monthly' = 'daily',
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const isAdmin =
      req.user.role === MerchantRole.ADMIN || req.user.role === MerchantRole.SUPERADMIN;

    return this.analyticsService.getVolume({
      scope: isAdmin ? 'admin' : 'merchant',
      merchantId: isAdmin ? undefined : req.user.merchantId,
      period,
      dateFrom,
      dateTo,
    });
  }

  @Get('funnel')
  @Scopes('analytics:read')
  @ApiOperation({ summary: 'Get payment funnel metrics' })
  @ApiQuery({ name: 'merchantId', required: false, description: 'Merchant to inspect; merchants may only pass their own ID' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date in YYYY-MM-DD format' })
  @ApiQuery({ name: 'to', required: false, description: 'End date in YYYY-MM-DD format' })
  @ApiQuery({ name: 'compareWith', enum: ['previous'], required: false })
  @ApiOkResponse({ description: 'Payment funnel metrics' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing analytics:read scope' })
  async getFunnel(
    @Request() req: { user: { merchantId: string; role: MerchantRole } },
    @Query('merchantId') merchantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('compareWith') compareWith?: 'previous',
  ) {
    const isAdmin =
      req.user.role === MerchantRole.ADMIN || req.user.role === MerchantRole.SUPERADMIN;

    if (!isAdmin && merchantId && merchantId !== req.user.merchantId) {
      throw new ForbiddenException('Cannot view funnel for another merchant');
    }

    return this.analyticsService.getFunnel(merchantId ?? req.user.merchantId, compareWith, from, to);
  }

  @Get('comparison')
  @Scopes('analytics:read')
  @ApiOperation({ summary: 'Compare current period with previous' })
  @ApiQuery({ name: 'period', enum: ['daily', 'monthly'], required: false })
  @ApiOkResponse({ description: 'Period comparison data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing analytics:read scope' })
  async getComparison(@Request() req, @Query('period') period: 'daily' | 'monthly' = 'daily') {
    return this.analyticsService.getComparison(req.user.merchantId, period);
  }

  @Get('networks')
  @Scopes('analytics:read')
  @ApiOperation({ summary: 'Get payment volume breakdown by blockchain network' })
  @ApiQuery({ name: 'sortBy', enum: ['volume', 'count'], required: false })
  @ApiQuery({ name: 'period', enum: ['daily', 'monthly'], required: false })
  @ApiOkResponse({ description: 'Network breakdown data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing analytics:read scope' })
  async getNetworkBreakdown(
    @Request() req,
    @Query('sortBy') sortBy: 'volume' | 'count' = 'volume',
    @Query('period') period: 'daily' | 'monthly' = 'daily',
  ) {
    return this.analyticsService.getNetworkBreakdown(req.user.merchantId, sortBy, period);
  }
}
