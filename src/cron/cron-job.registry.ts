import { Injectable, Inject, forwardRef, Logger, NotFoundException } from '@nestjs/common';
import { NotificationService } from '../notifications/notification.service';
import { SorobanEventIndexer } from '../stellar/soroban-event-indexer.service';
import { SettlementsService } from '../settlements/settlements.service';
import { UptimeHeartbeatService } from './uptime-heartbeat.service';
import { QueueMetricsService } from '../queues/queue-metrics.service';
import { CronJobService } from './cron-job.service';
import { getNextCronRun } from './cron-schedule.util';

/** A cron job that can be listed, inspected and triggered from the admin API. */
export interface CronJobDefinition {
  /** Stable job name, also used as the key in `cron_job_logs`. */
  name: string;
  /** Cron expression describing when the job runs. */
  schedule: string;
  /** Human readable purpose of the job. */
  description: string;
  /** The job implementation. */
  run: () => Promise<unknown>;
  /**
   * True when the job already records its own run history through
   * `CronJobService.run()` — the registry must not log it twice.
   */
  selfLogged?: boolean;
}

@Injectable()
export class CronJobRegistry {
  private readonly logger = new Logger(CronJobRegistry.name);
  private readonly jobs: Map<string, CronJobDefinition> = new Map();

  constructor(
    @Inject(forwardRef(() => NotificationService))
    private notificationService?: NotificationService,
    @Inject(forwardRef(() => SorobanEventIndexer))
    private sorobanIndexer?: SorobanEventIndexer,
    @Inject(forwardRef(() => SettlementsService))
    private settlementsService?: SettlementsService,
    private uptimeHeartbeat?: UptimeHeartbeatService,
    private queueMetrics?: QueueMetricsService,
    private cronJobService?: CronJobService,
  ) {
    this.setupJobs();
  }

  private setupJobs(): void {
    if (this.notificationService) {
      this.register({
        name: 'notification-purge',
        schedule: '0 0 * * *',
        description: 'Purges in-app notifications older than 30 days.',
        run: () => this.notificationService!.purgeOldNotifications(),
        selfLogged: true,
      });
    }
    if (this.sorobanIndexer) {
      this.register({
        name: 'soroban-event-indexer',
        schedule: '*/5 * * * * *',
        description: 'Polls the Soroban RPC for contract events and indexes them.',
        run: () => this.sorobanIndexer!.pollEvents(),
        selfLogged: true,
      });
    }
    if (this.settlementsService) {
      this.register({
        name: 'batch-small-confirmed-payments',
        schedule: '0 */15 * * * *',
        description: 'Batches confirmed payments below the instant-settlement threshold.',
        run: () => this.settlementsService!.batchSmallConfirmedPayments(),
        selfLogged: true,
      });
    }
    if (this.uptimeHeartbeat) {
      this.register({
        name: 'uptime-heartbeat',
        schedule: '*/5 * * * *',
        description: 'Sends the uptime heartbeat used by the external monitor.',
        run: () => this.uptimeHeartbeat!.ping(),
        selfLogged: true,
      });
    }
    if (this.queueMetrics) {
      this.register({
        name: 'queue-metrics-check',
        schedule: '* * * * *',
        description: 'Checks Bull queue depth/latency against the alerting thresholds.',
        run: () => this.queueMetrics!.collect(),
      });
    }
  }

  private register(definition: CronJobDefinition): void {
    this.jobs.set(definition.name, definition);
  }

  /** Names of every registered job. */
  getRegisteredJobs(): string[] {
    const availableJobs = Array.from(this.jobs.keys());
    if (availableJobs.length === 0) {
      this.logger.warn(
        'No jobs registered in CronJobRegistry; all job dependencies were unavailable',
      );
    }
    return availableJobs;
  }

  /** Full definitions (name, schedule, description) of every registered job. */
  getJobDefinitions(): Array<Pick<CronJobDefinition, 'name' | 'schedule' | 'description'>> {
    return Array.from(this.jobs.values()).map((job) => ({
      name: job.name,
      schedule: job.schedule,
      description: job.description,
    }));
  }

  /** Cron expression of a job, or `null` when the job is unknown. */
  getJobSchedule(jobName: string): string | null {
    return this.jobs.get(jobName)?.schedule ?? null;
  }

  /** Next execution time of a job, or `null` when the job is unknown. */
  getNextRun(jobName: string, from: Date = new Date()): Date | null {
    const schedule = this.getJobSchedule(jobName);
    if (!schedule) return null;
    return getNextCronRun(schedule, from);
  }

  /**
   * Runs a job on demand. The run is persisted in `cron_job_logs` so manual
   * triggers show up in the same history as scheduled runs.
   */
  async trigger(jobName: string): Promise<void> {
    const job = this.jobs.get(jobName);
    if (!job) {
      if (this.isKnownJobName(jobName)) {
        throw new NotFoundException(
          `Job not registered: ${jobName} (its dependency was unavailable at startup)`,
        );
      }
      throw new NotFoundException(`Unknown job name: ${jobName}`);
    }

    if (job.selfLogged || !this.cronJobService) {
      await job.run();
      return;
    }

    await this.cronJobService.run(jobName, async () => {
      await job.run();
    });
  }

  private isKnownJobName(jobName: string): boolean {
    return [
      'notification-purge',
      'soroban-event-indexer',
      'batch-small-confirmed-payments',
      'uptime-heartbeat',
      'queue-metrics-check',
    ].includes(jobName);
  }
}
