import { Injectable, Logger, RequestTimeoutException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronJobLog, CronJobStatus } from './entities/cron-job-log.entity';

@Injectable()
export class CronJobService {
  private readonly logger = new Logger(CronJobService.name);

  private static readonly LOCK_TTL_MS = 5 * 60 * 1000;
  private readonly runningJobs = new Set<string>();

  constructor(
    @InjectRepository(CronJobLog)
    private logRepo: Repository<CronJobLog>,
  ) {}

  async run<T>(jobName: string, fn: () => Promise<T>, expectedItems?: number): Promise<T> {
    if (this.runningJobs.has(jobName)) {
      const skipped = this.logRepo.create({
        jobName,
        status: CronJobStatus.SKIPPED,
        completedAt: new Date(),
        durationMs: 0,
      });
      await this.logRepo.save(skipped);
      this.logger.warn(`Cron ${jobName} skipped: already running`);
      return undefined as unknown as T;
    }

    this.runningJobs.add(jobName);

    const log = this.logRepo.create({
      jobName,
      status: CronJobStatus.STARTED,
    });
    await this.logRepo.save(log);

    const start = Date.now();

    try {
      // 5 min timeout
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new RequestTimeoutException(`Cron job ${jobName} exceeded 5min`)), CronJobService.LOCK_TTL_MS),
        ),
      ]);

      log.status = CronJobStatus.COMPLETED;
      log.completedAt = new Date();
      log.durationMs = Date.now() - start;
      log.itemsProcessed = expectedItems;
      await this.logRepo.save(log);

      this.logger.log(`Cron ${jobName} completed in ${log.durationMs}ms, processed ${log.itemsProcessed || 'N/A'}`);
      return result;
    } catch (error) {
      log.status = CronJobStatus.FAILED;
      log.completedAt = new Date();
      log.durationMs = Date.now() - start;
      log.errorMessage = error instanceof Error ? error.message : String(error);
      await this.logRepo.save(log);

      this.logger.error(`Cron ${jobName} failed: ${log.errorMessage} (${log.durationMs}ms)`);
      throw error;
    } finally {
      this.runningJobs.delete(jobName);
    }
  }
}
