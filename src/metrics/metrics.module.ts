import { Module, Global } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { makeHistogramProvider, makeCounterProvider } from '@willsoto/nestjs-prometheus';

const settlementBatchSizeHistogram = makeHistogramProvider({
  name: 'settlement_batch_size',
  help: 'Number of payments included in each settlement batch',
  labelNames: ['asset', 'status'],
  buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
});

const settlementBatchAmountUsdHistogram = makeHistogramProvider({
  name: 'settlement_batch_amount_usd',
  help: 'Total USD amount settled per settlement batch',
  labelNames: ['asset', 'status'],
  buckets: [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000],
});

const settlementSmallPaymentQueuedCounter = makeCounterProvider({
  name: 'settlement_small_payment_queued_total',
  help: 'Total number of small payments queued for batching',
  labelNames: ['asset'],
});

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
      },
      defaultLabels: {
        app: 'stellar-settlement',
      },
    }),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    settlementBatchSizeHistogram,
    settlementBatchAmountUsdHistogram,
    settlementSmallPaymentQueuedCounter,
  ],
  exports: [
    MetricsService,
    settlementBatchSizeHistogram,
    settlementBatchAmountUsdHistogram,
    settlementSmallPaymentQueuedCounter,
  ],
})
export class MetricsModule {}
