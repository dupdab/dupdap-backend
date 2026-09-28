import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/enums/merchant-role.enum';
import { MerchantAnalyticsService } from './merchant-analytics.service';
import { TopMerchantsQueryDto } from './dto/top-merchants-query.dto';
import { PaymentFunnelQueryDto } from './dto/payment-funnel-query.dto';
import {
  MerchantAnalyticsResponse,
  PaymentFunnelResponse,
  TopMerchantsResponse,
} from './interfaces/merchant-analytics.interface';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(MerchantRole.ADMIN)
export class MerchantAnalyticsController {
  constructor(
    private readonly merchantAnalyticsService: MerchantAnalyticsService,
  ) {}

  @Get('merchants')
  getMerchantAnalytics(): Promise<MerchantAnalyticsResponse> {
    return this.merchantAnalyticsService.getMerchantAnalytics();
  }

  @Get('top-merchants')
  getTopMerchants(
    @Query() query: TopMerchantsQueryDto,
  ): Promise<TopMerchantsResponse> {
    return this.merchantAnalyticsService.getTopMerchants(query);
  }

  @Get('funnel')
  getPaymentFunnel(
    @Query() query: PaymentFunnelQueryDto,
  ): Promise<PaymentFunnelResponse> {
    return this.merchantAnalyticsService.getPaymentFunnel(query);
  }
}
