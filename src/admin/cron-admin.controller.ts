import { Controller, Get, Post, Param, Query, UseGuards, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { CronJobLog, CronJobStatus } from '../../cron/entities/cron-job-log.entity';
import { CronJobRegistry } from '../../cron/cron-job.registry';

interface JobStatusDto {
  jobName: string;
  lastRun?: {
    status: CronJobStatus;
    completedAt?: Date;
    durationMs?: number;
    errorMessage?: string;
    itemsProcessed?: number;
  };
}

interface JobHistoryDto {
  id: string;
  jobName: string;
  status: CronJobStatus;
  startedAt: Date;
  completedAt?: Date;
  durationMs: number;
  errorMessage?: string;
  itemsProcessed?: number;
}

interface PaginatedHistoryDto {
  items: JobHistoryDto[];
  total: number;
  page: number;
  limit: number;
}

@ApiTags('admin.crons')
@UseGuards(AdminGuard)
@Controller({ path: 'admin/crons', version: '1' })
export class CronAdminController {
  constructor(
    @InjectRepository(CronJobLog)
    private logRepo: Repository<CronJobLog>,
    private jobRegistry: CronJobRegistry,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List cron jobs status' })
  async listJobs(): Promise<JobStatusDto[]> {
    const registered = this.jobRegistry.getRegisteredJobs();
    const statuses: JobStatusDto[] = [];

    for (const jobName of registered) {
      const lastRun = await this.logRepo.findOne({
        where: { jobName },
        order: { startedAt: 'DESC' },
      });

      statuses.push({
        jobName,
        lastRun: lastRun ? {
          status: lastRun.status,
          completedAt: lastRun.completedAt,
          durationMs: lastRun.durationMs,
          errorMessage: lastRun.errorMessage,
          itemsProcessed: lastRun.itemsProcessed,
        } : undefined,
      });
    }

    return statuses;
  }

  @Get(':jobName/history')
  @ApiOperation({ summary: 'Job history' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getHistory(
    @Param('jobName') jobName: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ): Promise<PaginatedHistoryDto> {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await this.logRepo.findAndCount({
      where: { jobName },
      order: { startedAt: 'DESC' },
      skip,
      take: limitNum,
    });

    return {
      items: items.map(log => ({
        id: log.id,
        jobName: log.jobName,
        status: log.status,
        startedAt: log.startedAt,
        completedAt: log.completedAt,
        durationMs: log.durationMs,
        errorMessage: log.errorMessage,
        itemsProcessed: log.itemsProcessed,
      })),
      total,
      page: pageNum,
      limit: limitNum,
    };
  }

  @Post(':jobName/trigger')
  @ApiOperation({ summary: 'Manual trigger' })
  async triggerJob(@Param('jobName') jobName: string) {
    const registered = this.jobRegistry.getRegisteredJobs();
    if (!registered.includes(jobName)) {
      throw new BadRequestException(`Unknown job: ${jobName}`);
    }

    try {
      await this.jobRegistry.trigger(jobName);
      return { triggered: true, jobName };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to trigger job: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

