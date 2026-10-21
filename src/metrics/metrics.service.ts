import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry: Registry;

  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDurationSeconds: Histogram<string>;
  readonly settlementBatchSize: Histogram<string>;
  readonly settlementBatchAmountUsd: Histogram<string>;
  readonly settlementSmallPaymentQueuedTotal: Counter<string>;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.settlementBatchSize = new Histogram({
      name: 'settlement_batch_size',
      help: 'Number of payments included in each settlement batch',
      buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry],
    });

    this.settlementBatchAmountUsd = new Histogram({
      name: 'settlement_batch_amount_usd',
      help: 'Total USD amount settled per settlement batch',
      buckets: [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000],
      registers: [this.registry],
    });

    this.settlementSmallPaymentQueuedTotal = new Counter({
      name: 'settlement_small_payment_queued_total',
      help: 'Total number of small payments queued for batching',
      registers: [this.registry],
    });
  }

  recordSettlementBatch(paymentCount: number, totalAmountUsd: number): void {
    this.settlementBatchSize.observe(paymentCount);
    this.settlementBatchAmountUsd.observe(totalAmountUsd);
  }

  recordSmallPaymentQueued(): void {
    this.settlementSmallPaymentQueuedTotal.inc();
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
