import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { NotificationService } from '../notifications/notification.service';
import { SorobanEventIndexer } from '../stellar/soroban-event-indexer.service';
import { SettlementsService } from '../settlements/settlements.service';
import { UptimeHeartbeatService } from './uptime-heartbeat.service';
import { QueueMetricsService } from '../queues/queue-metrics.service';

const KNOWN_JOBS = [
  'notification-purge',
  'soroban-event-indexer',
  'batch-small-confirmed-payments',
  'uptime-heartbeat',
  'queue-metrics-check',
];

@Injectable()
export class CronJobRegistry {
  private readonly logger = new Logger(CronJobRegistry.name);
  private readonly jobs: Map<string, () => Promise<void>> = new Map();

  constructor(
    @Inject(forwardRef(() => NotificationService))
    private notificationService?: NotificationService,
    @Inject(forwardRef(() => SorobanEventIndexer))
    private sorobanIndexer?: SorobanEventIndexer,
    @Inject(forwardRef(() => SettlementsService))
    private settlementsService?: SettlementsService,
    private uptimeHeartbeat?: UptimeHeartbeatService,
    private queueMetrics?: QueueMetricsService,
  ) {
    this.setupJobs();
  }

  private setupJobs(): void {
    if (this.notificationService) {
      this.jobs.set('notification-purge', () => this.notificationService!.purgeOldNotifications());
    }
    if (this.sorobanIndexer) {
      this.jobs.set('soroban-event-indexer', () => this.sorobanIndexer!.pollEvents());
    }
    if (this.settlementsService) {
      this.jobs.set('batch-small-confirmed-payments', () => this.settlementsService!.batchSmallConfirmedPayments());
    }
    if (this.uptimeHeartbeat) {
      this.jobs.set('uptime-heartbeat', () => this.uptimeHeartbeat!.ping());
    }
    if (this.queueMetrics) {
      this.jobs.set('queue-metrics-check', () => this.queueMetrics!.checkThresholds());
    }
  }

  getRegisteredJobs(): string[] {
    const availableJobs = Array.from(this.jobs.keys());
    if (availableJobs.length === 0) {
      this.logger.warn('No jobs registered in CronJobRegistry; falling back to known jobs list');
      return KNOWN_JOBS;
    }
    return availableJobs;
  }

  async trigger(jobName: string): Promise<void> {
    const fn = this.jobs.get(jobName);
    if (!fn) {
      throw new Error(`Job not found: ${jobName}`);
    }
    await fn();
  }
}
