import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository, Between } from 'typeorm';
import { CronJobLog, CronJobStatus } from './entities/cron-job-log.entity';
import { CronJobService } from './cron-job.service';
import { NotificationService } from '../notifications/notification.service';

const CRON_QUEUE = 'cron';

interface JobConfig {
  name: string;
  intervalMs: number; // e.g. 30000 for 30s
}

const JOB_REGISTRY: JobConfig[] = [
  { name: 'fetch-exchange-rate', intervalMs: 30_000 },
  { name: 'deposit-monitor', intervalMs: 30_000 },
  { name: 'settlement-processor', intervalMs: 15 * 60_000 },
  { name: 'yield-distributor', intervalMs: 24 * 60 * 60_000 },
  { name: 'waitlist-leaderboard-broadcast', intervalMs: 60_000 },
  { name: 'report-cleanup', intervalMs: 24 * 60 * 60_000 },
  { name: 'token-cleanup', intervalMs: 7 * 24 * 60 * 60_000 },
  { name: 'paylink-expiry', intervalMs: 5 * 60_000 },
  { name: 'contract-event-listener', intervalMs: 60_000 },
];

@Injectable()
@Processor(CRON_QUEUE)
export class CronHealthProcessor {
  private readonly logger = new Logger(CronHealthProcessor.name);

  constructor(
    @InjectRepository(CronJobLog)
    private logRepo: Repository<CronJobLog>,
    private cronService: CronJobService,
    private notificationService: NotificationService,
  ) {
    this.logger.log('CronHealthProcessor initialized');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduleHealthCheck(): Promise<void> {
    await this.cronService.run('cron-health-check', () => this.performHealthCheck());
  }

  @Process('cron-health-check')
  async checkHealth(job: Job) {
    await this.performHealthCheck();
  }

  private async performHealthCheck(): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 2 * 10 * 60 * 1000); // 20min ago for 10min check
    let missedCount = 0;

    for (const jobConfig of JOB_REGISTRY) {
      const lastCompleted = await this.logRepo.findOne({
        where: {
          jobName: jobConfig.name,
          status: CronJobStatus.COMPLETED,
          completedAt: MoreThan(cutoff),
        },
        order: { completedAt: 'DESC' },
      });

      if (!lastCompleted) {
        missedCount++;
        this.logger.warn(`Missed cron run: ${jobConfig.name}`);
        // Alert admin
        await this.notificationService.create({
          title: 'Cron Job Missed',
          body: `${jobConfig.name} has not completed in expected interval`,
          type: 'CRITICAL',
          recipientRole: 'admin',
        }).catch(() => {});

        // Could integrate Sentry here
      }
    }

    return missedCount;
  }
}

