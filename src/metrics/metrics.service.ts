import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly httpRequestsTotal: Counter<string>;
  private readonly httpRequestDuration: Histogram<string>;
  private readonly dbPoolUtilization: Gauge<string>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.dbPoolUtilization = new Gauge({
      name: 'db_pool_utilization_ratio',
      help: 'Database connection pool utilization (active / max connections)',
      registers: [this.registry],
    });

    this.registry.registerMetric(
      new Gauge({
        name: 'db_pool_connections',
        help: 'Database connection pool connection counts by state',
        labelNames: ['state'],
        registers: [this.registry],
        collect: (gauge) => {
          const pool = this.getPoolStats();
          gauge.set({ state: 'active' }, pool.active);
          gauge.set({ state: 'idle' }, pool.idle);
          gauge.set({ state: 'total' }, pool.total);
          gauge.set({ state: 'max' }, pool.max);
        },
      }),
    );

    this.dbPoolUtilization.collect = () => {
      const pool = this.getPoolStats();
      const ratio = pool.max > 0 ? pool.active / pool.max : 0;
      this.dbPoolUtilization.set(ratio);
    };
  }

  private getPoolStats(): { active: number; idle: number; total: number; max: number } {
    const driver = (this.dataSource as unknown as { driver?: { master?: any } }).driver;
    const pool = driver?.master;
    const max = Number(process.env.DB_POOL_MAX ?? 20);

    if (!pool) {
      return { active: 0, idle: 0, total: 0, max };
    }

    const total = typeof pool.totalCount === 'number' ? pool.totalCount : 0;
    const idle = typeof pool.idleCount === 'number' ? pool.idleCount : 0;
    const active = typeof pool.activeCount === 'number' ? pool.activeCount : Math.max(total - idle, 0);

    return { active, idle, total, max };
  }

  observeHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = { method, route, status: String(status) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
