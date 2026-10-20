import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Gauge } from 'prom-client';
import { DataSource } from 'typeorm';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';

/** Open connections in the DB pool (idle + active). */
export const dbPoolSize = new Gauge({
  name: 'db_pool_size',
  help: 'Number of open connections in the DB pool (idle + active)',
});

/** Connections currently checked out of the DB pool. */
export const dbPoolActive = new Gauge({
  name: 'db_pool_active_connections',
  help: 'Number of DB pool connections currently in use',
});

/** Queries waiting for a free DB pool connection. */
export const dbPoolWaiting = new Gauge({
  name: 'db_pool_waiting_queries',
  help: 'Number of queries waiting for a DB pool connection',
});

const HIGH_UTILIZATION_RATIO = 0.8;
const HIGH_UTILIZATION_SUSTAIN_MS = 60_000;

/**
 * Monitors the TypeORM connection pool and logs a warning when the pool
 * is exhausted (all connections in use). Runs a periodic check every 30s.
 * Also raises an admin alert so the operations team is paged, and exports
 * pool gauges to Prometheus (db_pool_size, db_pool_active_connections,
 * db_pool_waiting_queries).
 */
@Injectable()
export class PoolMonitorService implements OnModuleInit {
  private readonly logger = new Logger(PoolMonitorService.name);
  private intervalRef: NodeJS.Timeout | null = null;
  private highUtilizationSince: number | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly alertService: AdminAlertService,
  ) {}

  onModuleInit() {
    this.intervalRef = setInterval(() => this.checkPool(), 30_000);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
  }

  private async checkPool() {
    // TypeORM uses `pg` driver; the underlying pool is accessible via driver
    const pool = (this.dataSource.driver as any)?.master;
    if (!pool) return;

    const total: number = pool.totalCount ?? 0;
    const idle: number = pool.idleCount ?? 0;
    const waiting: number = pool.waitingCount ?? 0;
    const active = total - idle;
    const max: number = pool.options?.max ?? total;

    dbPoolSize.set(total);
    dbPoolActive.set(active);
    dbPoolWaiting.set(waiting);

    const now = Date.now();
    if (max > 0 && active / max > HIGH_UTILIZATION_RATIO) {
      this.highUtilizationSince ??= now;
    } else {
      this.highUtilizationSince = null;
    }

    if (
      this.highUtilizationSince !== null &&
      now - this.highUtilizationSince >= HIGH_UTILIZATION_SUSTAIN_MS
    ) {
      const message = `[DB Pool] Utilization above 80% for over 60s — total=${total} active=${active} max=${max}`;
      this.logger.warn(message);
      await this.alertService.raise({
        type: AdminAlertType.DB_POOL_EXHAUSTED,
        dedupeKey: 'db-pool-high-utilization',
        message,
        metadata: { total, active, max, waiting },
        thresholdValue: 1,
      });
    }

    if (waiting > 0) {
      this.logger.warn(
        `[DB Pool] Pool exhausted — total=${total} active=${active} idle=${idle} waiting=${waiting}`,
      );
      await this.alertService.raise({
        type: AdminAlertType.DB_POOL_EXHAUSTED,
        dedupeKey: 'db-pool-exhausted',
        message: `[DB Pool] Pool exhausted — total=${total} active=${active} idle=${idle} waiting=${waiting}`,
        metadata: { total, active, idle, waiting },
        thresholdValue: 1,
      });
    }
  }
}
