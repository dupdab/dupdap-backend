import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Gauge } from 'prom-client';
import { Repository } from 'typeorm';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { CronJobService } from '../cron/cron-job.service';
import { DailyPaymentVolume } from './entities/daily-payment-volume.view';

/** Duration of the most recent materialized view refresh. */
export const analyticsRefreshDurationSeconds = new Gauge({
  name: 'analytics_refresh_duration_seconds',
  help: 'Duration of the last analytics materialized view refresh in seconds',
  labelNames: ['view', 'status'],
});

/** Unix timestamp of the last successful refresh. */
export const analyticsRefreshLastSuccessTimestamp = new Gauge({
  name: 'analytics_refresh_last_success_timestamp_seconds',
  help: 'Unix timestamp of the last successful analytics materialized view refresh',
  labelNames: ['view'],
});

/** A refresh running longer than this raises an admin alert. */
export const ANALYTICS_REFRESH_SLOW_MS = 60_000;

const VIEW_NAME = 'mv_daily_payment_volume';

export type AnalyticsRefreshTrigger = 'cron' | 'manual';

@Injectable()
export class AnalyticsRefreshService {
  private readonly logger = new Logger(AnalyticsRefreshService.name);

  constructor(
    @InjectRepository(DailyPaymentVolume)
    private readonly viewRepo: Repository<DailyPaymentVolume>,
    private readonly cronJobService: CronJobService,
    private readonly adminAlerts: AdminAlertService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async refreshMaterializedViews(): Promise<void> {
    await this.cronJobService.run('refresh-mv-daily-payment-volume', async () => {
      await this.refresh('cron');
    });
  }

  /**
   * Refreshes the view, logging failures, recording metrics and alerting admins
   * when the refresh fails or runs longer than {@link ANALYTICS_REFRESH_SLOW_MS}.
   * Errors are rethrown so callers (cron log, admin endpoint) see the failure.
   */
  async refresh(trigger: AnalyticsRefreshTrigger = 'manual'): Promise<{ durationMs: number }> {
    const startedAt = Date.now();
    let slowAlert: Promise<unknown> | undefined;
    const slowTimer = setTimeout(() => {
      this.logger.warn(
        `Refresh of ${VIEW_NAME} still running after ${ANALYTICS_REFRESH_SLOW_MS}ms (trigger=${trigger})`,
      );
      slowAlert = this.raiseAlert(
        'slow',
        `Materialized view ${VIEW_NAME} refresh has been running for more than ${ANALYTICS_REFRESH_SLOW_MS / 1000}s; analytics data may be stale.`,
        { view: VIEW_NAME, trigger, thresholdMs: ANALYTICS_REFRESH_SLOW_MS },
      );
    }, ANALYTICS_REFRESH_SLOW_MS);

    try {
      await this.viewRepo.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${VIEW_NAME}`);

      const durationMs = Date.now() - startedAt;
      analyticsRefreshDurationSeconds.set({ view: VIEW_NAME, status: 'success' }, durationMs / 1000);
      analyticsRefreshLastSuccessTimestamp.set({ view: VIEW_NAME }, Math.floor(Date.now() / 1000));
      this.logger.log(`Refreshed ${VIEW_NAME} in ${durationMs}ms (trigger=${trigger})`);
      return { durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      analyticsRefreshDurationSeconds.set({ view: VIEW_NAME, status: 'failure' }, durationMs / 1000);
      this.logger.error(
        `Refresh of ${VIEW_NAME} failed after ${durationMs}ms (trigger=${trigger}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.raiseAlert(
        'failed',
        `Materialized view ${VIEW_NAME} refresh failed after ${durationMs}ms: ${message}`,
        { view: VIEW_NAME, trigger, durationMs, error: message },
      );
      throw error;
    } finally {
      clearTimeout(slowTimer);
      await slowAlert;
    }
  }

  private async raiseAlert(
    kind: 'slow' | 'failed',
    message: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.adminAlerts.raise({
        type: AdminAlertType.ANALYTICS_REFRESH,
        dedupeKey: `${VIEW_NAME}:${kind}`,
        message,
        metadata,
        thresholdValue: 1,
      });
    } catch (alertError) {
      this.logger.error(
        `Failed to raise analytics refresh alert: ${alertError instanceof Error ? alertError.message : alertError}`,
      );
    }
  }
}
