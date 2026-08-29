import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CronJobService } from '../cron/cron-job.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';

@ApiTags('admin.crons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'admin/crons', version: '1' })
export class CronAdminController {
  constructor(private cronService: CronJobService) {}

  @Get()
  @Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
  @ApiOperation({ summary: 'List cron jobs status' })
  async listJobs() {
    // Return registry + last run stats
    return []; // TODO: implement
  }

  @Get(':jobName/history')
  @Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
  @ApiOperation({ summary: 'Job history' })
  async getHistory(
    @Param('jobName') jobName: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return []; // TODO: paginated logs
  }

  @Post(':jobName/trigger')
  @Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
  @ApiOperation({ summary: 'Manual trigger' })
  async triggerJob(@Param('jobName') jobName: string) {
    // Validate jobName in registry, then run
    return { triggered: true };
  }
}

