import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';

/** RuntimeConfig key overriding the per-API-key payment creation limit. */
export const PAYMENT_CREATION_RATE_LIMIT_KEY = 'payments.creation_rate_limit_per_minute';
export const DEFAULT_PAYMENT_CREATION_RATE_LIMIT = 60;
const WINDOW_SECONDS = 60;

/**
 * Per-API-key rate limit for payment creation (#809).
 *
 * Uses a Redis-backed sliding window counter (via CacheService) keyed by the
 * API key, so the limit holds across instances. The limit defaults to 60
 * creations per minute and is configurable via RuntimeConfig. On breach a 429
 * is thrown with a `Retry-After` header.
 */
@Injectable()
export class PaymentCreationRateLimitService {
  private readonly logger = new Logger(PaymentCreationRateLimitService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  async checkAndIncrement(apiKey: string): Promise<void> {
    const limit = await this.resolveLimit();
    const key = `ratelimit:payments:create:${apiKey}`;

    const result = await this.cache.checkSlidingWindowRateLimit(key, {
      limit,
      windowSeconds: WINDOW_SECONDS,
    });

    if (result.allowed) {
      return;
    }

    this.logger.warn(`Payment creation rate limit exceeded for API key (${limit}/min)`);

    const retryAfter = Math.max(result.retryAfter ?? WINDOW_SECONDS, 0);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: 'PAYMENT_RATE_LIMIT_EXCEEDED',
        message: 'Payment creation rate limit exceeded. Please try again later.',
        retryAfter,
        reset: result.resetAt,
      },
      HttpStatus.TOO_MANY_REQUESTS,
      { headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  private async resolveLimit(): Promise<number> {
    const configured = await this.runtimeConfig.get<number | string>(
      PAYMENT_CREATION_RATE_LIMIT_KEY,
      DEFAULT_PAYMENT_CREATION_RATE_LIMIT,
    );
    const parsed = Number(configured);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_PAYMENT_CREATION_RATE_LIMIT;
  }
}
