import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { dbSlowQueryTotal } from '../database/slow-query.logger';

@Injectable()
export class MetricsService {
  readonly paymentCreatedTotal: Counter<string>;
  readonly paymentSettledTotal: Counter<string>;
  readonly settlementFailedTotal: Counter<string>;
  readonly settlementDurationSeconds: Histogram<string>;

  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDurationMs: Histogram<string>;
  readonly cacheRequestsTotal: Counter<string>;
  readonly openAdminAlerts: Gauge<string>;
  readonly dbSlowQueryTotal: Counter<string>;

  constructor() {
    this.paymentCreatedTotal = new Counter({
      name: 'payment_created_total',
      help: 'Total number of payments created',
      labelNames: ['type'],
    });

    this.paymentSettledTotal = new Counter({
      name: 'payment_settled_total',
      help: 'Total number of payments successfully settled',
      labelNames: ['type'],
    });

    this.settlementFailedTotal = new Counter({
      name: 'settlement_failed_total',
      help: 'Total number of settlement failures',
      labelNames: ['type'],
    });

    this.settlementDurationSeconds = new Histogram({
      name: 'settlement_duration_seconds',
      help: 'Time spent processing settlements in seconds',
      labelNames: ['type'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
    });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
    });

    this.httpRequestDurationMs = new Histogram({
      name: 'http_request_duration_ms',
      help: 'HTTP request latency in milliseconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    });

    this.cacheRequestsTotal = new Counter({
      name: 'cache_requests_total',
      help: 'Total cache lookups by key pattern and result',
      labelNames: ['key_pattern', 'result'],
    });

    // Shared with SlowQueryLogger (single registration, exposed via /metrics).
    this.dbSlowQueryTotal = dbSlowQueryTotal;

    this.openAdminAlerts = new Gauge({
      name: 'admin_alerts_open',
      help: 'Number of currently open admin alerts',
      labelNames: ['type'],
    });
  }

  incrementPaymentCreated(type: string): void {
    this.paymentCreatedTotal.inc({ type });
  }

  incrementPaymentSettled(type: string): void {
    this.paymentSettledTotal.inc({ type });
  }

  incrementSettlementFailed(type: string): void {
    this.settlementFailedTotal.inc({ type });
  }

  observeSettlementDuration(type: string, durationSeconds: number): void {
    this.settlementDurationSeconds.observe({ type }, durationSeconds);
  }

  recordHttpRequest(
    method: string,
    route: string,
    status: number | string,
    durationMs: number,
  ): void {
    const labels = { method, route, status: String(status) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationMs.observe(labels, durationMs);
  }

  recordCacheLookup(keyPattern: string, result: 'hit' | 'miss'): void {
    this.cacheRequestsTotal.inc({ key_pattern: keyPattern, result });
  }

  setOpenAdminAlerts(type: string, count: number): void {
    this.openAdminAlerts.set({ type }, count);
  }

  recordDbSlowQuery(table: string): void {
    this.dbSlowQueryTotal.inc({ table });
  }
}

