import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

/** Max number of negative blacklist lookups kept in the process-local LRU. */
export const BLACKLIST_NEGATIVE_CACHE_MAX_ENTRIES = 1000;
/** TTL (ms) for a cached "not blacklisted" answer. */
export const BLACKLIST_NEGATIVE_CACHE_TTL_MS = 60_000;

interface NegativeCacheEntry {
  expiresAt: number;
}

/**
 * Bounded LRU cache for negative (not-blacklisted) lookups (#842).
 *
 * `Map` preserves insertion order, so re-inserting a key on read moves it to
 * the most-recently-used end and the first key is always the LRU victim.
 */
export class NegativeBlacklistCache {
  private readonly entries = new Map<string, NegativeCacheEntry>();

  constructor(
    private readonly maxEntries: number = BLACKLIST_NEGATIVE_CACHE_MAX_ENTRIES,
    private readonly ttlMs: number = BLACKLIST_NEGATIVE_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the jti is known to be *not* blacklisted and the entry is fresh. */
  has(jti: string): boolean {
    const entry = this.entries.get(jti);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(jti);
      return false;
    }
    // Refresh recency.
    this.entries.delete(jti);
    this.entries.set(jti, entry);
    return true;
  }

  set(jti: string): void {
    this.entries.delete(jti);
    this.entries.set(jti, { expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Drop a single jti (used on logout so revocation is visible immediately). */
  delete(jti: string): void {
    this.entries.delete(jti);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

@Injectable()
export class AuthService {
  private readonly negativeBlacklistCache = new NegativeBlacklistCache();

  constructor(private readonly cache: CacheService) {}

  /**
   * Whether the session (jti) has been revoked. Negative answers are served
   * from a local LRU cache so the hot auth path avoids a Redis round-trip.
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    if (this.negativeBlacklistCache.has(jti)) {
      return false;
    }

    const revoked = await this.cache.get<boolean>(`blacklist:${jti}`);
    if (revoked) {
      return true;
    }

    this.negativeBlacklistCache.set(jti);
    return false;
  }

  /** Revoke a session and invalidate its cached negative lookup immediately. */
  async logout(jti: string, ttlSeconds: number): Promise<void> {
    this.negativeBlacklistCache.delete(jti);
    await this.cache.set(`blacklist:${jti}`, true, {
      ttlSeconds: Math.max(ttlSeconds, 1),
    });
  }
}
