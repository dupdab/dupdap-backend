import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../cache/cache.service';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { TransactionLimitExceededException } from './transaction-limit.exception';

const DAY_SECONDS = 24 * 60 * 60;
const BREACH_ALERT_THRESHOLD = 3;

/**
 * Enforces per-merchant daily transaction limits at payment creation (#553).
 * Uses Redis-backed rolling 24h window counters via CacheService, so limits
 * hold across instances. Throws TransactionLimitExceededException (mapped to
 * 429 + `X-Limit-Reset` by TransactionLimitFilter) on breach, and raises an
 * admin alert on repeated breaches.
 */
@Injectable()
export class TransactionLimitsService {
  private readonly logger = new Logger(TransactionLimitsService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly adminAlerts: AdminAlertService,
  ) {}

  async checkAndIncrement(merchantId: string): Promise<void> {
    const limit = this.config.get<number>('MERCHANT_DAILY_TX_LIMIT', 100);

    const result = await this.cache.checkSlidingWindowRateLimit(
      `payments:daily-tx:${merchantId}`,
      { limit, windowSeconds: DAY_SECONDS },
    );

    if (result.allowed) {
      return;
    }

    this.logger.warn(
      `Merchant ${merchantId} exceeded daily transaction limit (${limit}/24h)`,
    );

    const day = new Date().toISOString().slice(0, 10);
    const breachKey = `payments:tx-breaches:${merchantId}:${day}`;
    const breaches = ((await this.cache.get<number>(breachKey)) ?? 0) + 1;
    await this.cache.set(breachKey, breaches, { ttlSeconds: DAY_SECONDS });

    if (breaches >= BREACH_ALERT_THRESHOLD) {
      await this.adminAlerts.raise({
        type: AdminAlertType.TRANSACTION_LIMIT,
        dedupeKey: `tx-limit:${merchantId}:${day}`,
        message: `Merchant ${merchantId} breached the daily transaction limit ${breaches} times (limit: ${limit}/24h)`,
        metadata: { merchantId, breaches, limit },
        thresholdValue: 1,
      });
    }

    throw new TransactionLimitExceededException(result.resetAt, result.retryAfter);
  }
}
