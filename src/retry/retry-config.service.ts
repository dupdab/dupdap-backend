import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RetryConfig {
  maxAttempts: number;
  delaysMs: number[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

@Injectable()
export class RetryConfigService {
  constructor(private config: ConfigService) {}

  get settlement(): RetryConfig {
    return {
      maxAttempts: this.config.get<number>('SETTLEMENT_RETRY_COUNT', 3),
      delaysMs: this.parseDelays(
        this.config.get('SETTLEMENT_RETRY_DELAYS_MS'),
        [1 * MINUTE, 5 * MINUTE, 30 * MINUTE],
      ),
    };
  }

  get webhook(): RetryConfig {
    return {
      maxAttempts: this.config.get<number>('WEBHOOK_RETRY_COUNT', 5),
      delaysMs: this.parseDelays(
        this.config.get('WEBHOOK_RETRY_DELAYS_MS'),
        [1 * MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 12 * HOUR],
      ),
    };
  }

  get email(): RetryConfig {
    return {
      maxAttempts: this.config.get<number>('EMAIL_RETRY_COUNT', 1),
      delaysMs: this.parseDelays(
        this.config.get('EMAIL_RETRY_DELAYS_MS'),
        [5 * MINUTE],
      ),
    };
  }

  /**
   * Default payment retry policy (#551): 3 attempts, 5 minute delay.
   * Per-merchant overrides live on the Merchant entity — see resolvePaymentRetry().
   */
  get payment(): RetryConfig {
    return {
      maxAttempts: this.config.get<number>('PAYMENT_RETRY_COUNT', 3),
      delaysMs: this.parseDelays(
        this.config.get('PAYMENT_RETRY_DELAYS_MS'),
        [5 * MINUTE],
      ),
    };
  }

  /**
   * Resolve the effective payment retry policy for a merchant.
   * Merchant-level `paymentRetryMaxAttempts` / `paymentRetryDelayMs` win;
   * otherwise fall back to the global payment defaults above.
   */
  resolvePaymentRetry(merchant?: {
    paymentRetryMaxAttempts?: number | null;
    paymentRetryDelayMs?: number | null;
  }): RetryConfig {
    const defaults = this.payment;
    const maxAttempts =
      merchant?.paymentRetryMaxAttempts && merchant.paymentRetryMaxAttempts > 0
        ? merchant.paymentRetryMaxAttempts
        : defaults.maxAttempts;
    const baseDelay =
      merchant?.paymentRetryDelayMs && merchant.paymentRetryDelayMs > 0
        ? Number(merchant.paymentRetryDelayMs)
        : defaults.delaysMs[0];
    return {
      maxAttempts,
      delaysMs: Array.from({ length: maxAttempts }, () => baseDelay),
    };
  }

  get stellarMonitor(): RetryConfig {
    return {
      maxAttempts: this.config.get<number>('STELLAR_MONITOR_RETRY_COUNT', 1),
      delaysMs: this.parseDelays(
        this.config.get('STELLAR_MONITOR_RETRY_DELAYS_MS'),
        [0],
      ),
    };
  }

  private parseDelays(raw: string | undefined, defaults: number[]): number[] {
    if (!raw) return defaults;
    return raw.split(',').map((v) => parseInt(v.trim(), 10));
  }
}
