import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp (seconds)
  retryAfter?: number; // seconds until reset
}

// Requests per hour by role
const RATE_LIMITS: Record<string, number> = {
  superadmin: 10_000,
  admin: 5_000,
  merchant: 1_000,
};

const WINDOW_SECONDS = 3600; // 1 hour sliding window

@Injectable()
export class RateLimitService {
  constructor(private readonly cache: CacheService) {}

  async checkApiKeyRateLimit(merchantId: string, role: string): Promise<RateLimitResult> {
    const limit = RATE_LIMITS[role] ?? RATE_LIMITS['merchant'];
    const key = `ratelimit:apikey:${merchantId}`;

    const result = await this.cache.checkSlidingWindowRateLimit(key, {
      limit,
      windowSeconds: WINDOW_SECONDS,
    });

    return {
      allowed: result.allowed,
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.resetAt,
      ...(result.retryAfter !== undefined ? { retryAfter: result.retryAfter } : {}),
    };
  }
}
