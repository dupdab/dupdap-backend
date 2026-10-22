import {
  ApiOperation as AdminOperation,
  ApiResponse as AdminResponse,
  ApiBearerAuth as AdminBearer,
} from '@nestjs/swagger';
import { ApiErrors } from '../common/api-errors.decorator';
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CronJobLog, CronJobStatus } from '../cron/entities/cron-job-log.entity';
import { CronJobRegistry } from '../cron/cron-job.registry';
import { Auditable } from '../audit/decorators/auditable.decorator';

interface JobLastRunDto {
  status: CronJobStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  errorMessage?: string;
  itemsProcessed?: number;
}

interface JobStatusDto {
  jobName: string;
  /** Cron expression the job runs on. */
  schedule: string;
  description?: string;
  lastRun?: JobLastRunDto;
  /** Next execution time, or null when the job is not scheduled. */
  nextRun: Date | null;
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
  totalPages: number;
}

@ApiTags('admin.crons')
@UseGuards(AdminGuard)
@ApiErrors()
@AdminBearer('bearer')
@Controller({ path: 'admin/crons', version: '1' })
export class CronAdminController {
  constructor(
    @InjectRepository(CronJobLog)
    private logRepo: Repository<CronJobLog>,
    private jobRegistry: CronJobRegistry,
  ) {}

  @AdminResponse({ status: 200, description: 'Successful response' })
  @Get()
  @ApiOperation({
    summary: 'List cron jobs',
    description:
      'Returns every registered cron job with its schedule, the last recorded run and the next scheduled run.',
  })
  async listJobs(): Promise<JobStatusDto[]> {
    const definitions = this.jobRegistry.getJobDefinitions();
    const statuses: JobStatusDto[] = [];

    for (const definition of definitions) {
      const lastRun = await this.logRepo.findOne({
        where: { jobName: definition.name },
        order: { startedAt: 'DESC' },
      });

      statuses.push({
        jobName: definition.name,
        schedule: definition.schedule,
        description: definition.description,
        lastRun: lastRun
          ? {
              status: lastRun.status,
              startedAt: lastRun.startedAt,
              completedAt: lastRun.completedAt,
              durationMs: lastRun.durationMs,
              errorMessage: lastRun.errorMessage,
              itemsProcessed: lastRun.itemsProcessed,
            }
          : undefined,
        nextRun: this.jobRegistry.getNextRun(definition.name),
      });
    }

    return statuses;
  }

  @AdminResponse({ status: 200, description: 'Successful response' })
  @Get(':jobName/history')
  @ApiOperation({
    summary: 'Job run history',
    description:
      'Paginated run history for a cron job, including status, duration and error message of every run.',
  })
  @ApiParam({ name: 'jobName', description: 'Cron job name' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (1-based)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (max 100)' })
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
      items: items.map((log) => ({
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
      totalPages: Math.ceil(total / limitNum),
    };
  }

  @AdminResponse({ status: 201, description: 'Successful response' })
  @Post(':jobName/trigger')
  @ApiOperation({
    summary: 'Manual trigger',
    description:
      'Runs the job immediately. The run is persisted in the cron job history like a scheduled run.',
  })
  @ApiParam({ name: 'jobName', description: 'Cron job name' })
  @Auditable({ action: 'CRON_JOB_TRIGGERED', resource: 'cron-job' })
  async triggerJob(@Param('jobName') jobName: string) {
    const registered = this.jobRegistry.getRegisteredJobs();
    if (!registered.includes(jobName)) {
      throw new BadRequestException(`Unknown job: ${jobName}`);
    }

    try {
      await this.jobRegistry.trigger(jobName);
      return { triggered: true, jobName };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not found')) {
        throw new NotFoundException(message);
      }
      throw new InternalServerErrorException(`Failed to trigger job: ${message}`);
    }
  }
}
