import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/enums/merchant-role.enum';
import { QueueMetricsService } from './queue-metrics.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from './queue.constants';

@ApiTags('admin/queues')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(MerchantRole.ADMIN)
@Controller('admin/queues')
export class QueueAdminController {
  constructor(
    private readonly queueMetricsService: QueueMetricsService,
    @InjectQueue(QUEUE_NAMES.settlement) private readonly settlementQueue: Queue,
    @InjectQueue(QUEUE_NAMES.webhookDelivery) private readonly webhookDeliveryQueue: Queue,
    @InjectQueue(QUEUE_NAMES.emailDelivery) private readonly emailDeliveryQueue: Queue,
    @InjectQueue(QUEUE_NAMES.stellarMonitor) private readonly stellarMonitorQueue: Queue,
    @InjectQueue(QUEUE_NAMES.sorobanEventDlq) private readonly sorobanEventDlqQueue: Queue,
  ) {}

  @Get('metrics')
  async getMetrics() {
    return this.queueMetricsService.getMetrics();
  }

  @Get(':name/failed')
  async getFailedJobs(@Param('name') name: string) {
    const queue = this.getQueue(name);
    const jobs = await queue.getFailed();
    return {
      jobs: jobs.map((j) => ({
        id: j.id,
        name: j.name,
        data: j.data,
        failedReason: j.failedReason,
        attemptsMade: j.attemptsMade,
      })),
      total: jobs.length,
    };
  }

  @Post(':name/failed/:id/retry')
  async retryFailedJob(@Param('name') name: string, @Param('id') id: string) {
    const queue = this.getQueue(name);
    const job = await queue.getJob(id);
    if (!job) {
      return { success: false, message: 'Job not found' };
    }
    await job.retry();
    return { success: true };
  }

  private getQueue(name: string): Queue {
    switch (name) {
      case QUEUE_NAMES.settlement:
        return this.settlementQueue;
      case QUEUE_NAMES.webhookDelivery:
        return this.webhookDeliveryQueue;
      case QUEUE_NAMES.emailDelivery:
        return this.emailDeliveryQueue;
      case QUEUE_NAMES.stellarMonitor:
        return this.stellarMonitorQueue;
      case QUEUE_NAMES.sorobanEventDlq:
        return this.sorobanEventDlqQueue;
      default:
        throw new Error(`Unknown queue: ${name}`);
    }
  }
}
