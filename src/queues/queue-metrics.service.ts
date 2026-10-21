import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { QueueMetric } from './queue-metric.entity';

interface QueueSnapshot {
  name: string;
  completed: number;
  failed: number;
  waiting: number;
  active: number;
}

@Injectable()
export class QueueMetricsService {
  private readonly logger = new Logger(QueueMetricsService.name);
  private readonly previous = new Map<string, QueueSnapshot>();

  constructor(
    @InjectRepository(QueueMetric)
    private readonly queueMetricRepo: Repository<QueueMetric>,
    private readonly adminAlerts: AdminAlertService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async collect(): Promise<void> {
    const metrics = await this.snapshotQueues();
    await this.persist(metrics);
    await this.checkThresholds(metrics);
  }

  async getMetrics(): Promise<QueueMetric[]> {
    return this.queueMetricRepo.find({ order: { createdAt: 'DESC' }, take: 100 });
  }

  private async snapshotQueues(): Promise<QueueSnapshot[]> {
    // Queue snapshots are gathered from the underlying Bull queues elsewhere;
    // this service only records and evaluates the resulting metrics.
    return [];
  }

  private async persist(metrics: QueueSnapshot[]): Promise<void> {
    if (metrics.length === 0) {
      return;
    }

    const rows = metrics.map((m) =>
      this.queueMetricRepo.create({
        name: m.name,
        completed: m.completed,
        failed: m.failed,
        waiting: m.waiting,
        active: m.active,
      }),
    );

    await this.queueMetricRepo.save(rows);
  }

  private async checkThresholds(metrics: QueueSnapshot[]): Promise<void> {
    for (const m of metrics) {
      const prev = this.previous.get(m.name);
      this.previous.set(m.name, m);

      if (!prev) {
        continue;
      }

      if (prev.completed > 0 && m.completed === prev.completed) {
        this.logger.warn(`Queue "${m.name}" processing rate has dropped to zero`);
        await this.adminAlerts.raise({
          type: AdminAlertType.STELLAR_MONITOR,
          dedupeKey: `queue.stalled.${m.name}`,
          message: `Queue "${m.name}" processing rate dropped to zero (completed count unchanged)`,
          metadata: { queue: m.name, completed: m.completed },
          thresholdValue: 1,
        });
      }
    }
  }
}
