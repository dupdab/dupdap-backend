import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../common/api-errors.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminTwoFactorGuard } from '../auth/guards/admin-two-factor.guard';
import { AnalyticsRefreshService } from './analytics-refresh.service';

@ApiTags('admin / analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminTwoFactorGuard, RolesGuard)
@Roles(MerchantRole.SUPERADMIN)
@ApiErrors()
@Controller('admin/analytics')
export class AnalyticsRefreshAdminController {
  constructor(private readonly refreshService: AnalyticsRefreshService) {}

  @Post('refresh')
  @ApiOperation({ summary: 'Manually refresh the analytics materialized views' })
  async refresh() {
    const { durationMs } = await this.refreshService.refresh('manual');
    return { refreshed: true, durationMs };
  }
}
