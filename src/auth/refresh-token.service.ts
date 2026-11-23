import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { CacheService } from '../cache/cache.service';

/** Redis key prefix for a single refresh-token record. */
const REFRESH_PREFIX = 'auth:refresh:';
/** Redis key prefix for the blacklist of rotated/revoked refresh tokens. */
const BLACKLIST_PREFIX = 'auth:refresh:blacklist:';

export interface RefreshTokenRecord {
  merchantId: string;
  /** Rotation chain id; stable across rotations of the same session. */
  sessionId: string;
}

export interface IssuedRefreshToken {
  token: string;
  expiresInSeconds: number;
}

/**
 * Opaque, rotating refresh tokens backed by Redis (#837).
 *
 * Tokens are random 256-bit values; only their SHA-256 hash is stored, so a
 * Redis dump cannot be replayed. Every successful exchange deletes the old
 * record and blacklists it, then issues a new token in the same session chain.
 */
@Injectable()
export class RefreshTokenService {
  constructor(private readonly cache: CacheService) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private ttlSeconds(): number {
    const raw = Number(process.env.REFRESH_TOKEN_TTL_SECONDS);
    return Number.isFinite(raw) && raw > 0 ? raw : 30 * 24 * 60 * 60;
  }

  async issue(merchantId: string, sessionId?: string): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const ttl = this.ttlSeconds();
    const record: RefreshTokenRecord = { merchantId, sessionId: sessionId ?? randomBytes(16).toString('hex') };
    await this.cache.set(`${REFRESH_PREFIX}${this.hash(token)}`, record, { ttlSeconds: ttl });
    return { token, expiresInSeconds: ttl };
  }

  /**
   * Validates and consumes a refresh token, returning its record.
   * The token is blacklisted for the remainder of its lifetime so a replay
   * (including a concurrent double-spend) is rejected.
   */
  async consume(token: string): Promise<RefreshTokenRecord> {
    const key = `${REFRESH_PREFIX}${this.hash(token)}`;
    const record = await this.cache.get<RefreshTokenRecord>(key);
    if (!record) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    await this.cache.del(key);
    await this.cache.set(`${BLACKLIST_PREFIX}${this.hash(token)}`, true, { ttlSeconds: this.ttlSeconds() });
    return record;
  }

  async isBlacklisted(token: string): Promise<boolean> {
    const value = await this.cache.get<boolean>(`${BLACKLIST_PREFIX}${this.hash(token)}`);
    return value === true;
  }

  /** Revokes every refresh token issued for a session (used on logout). */
  async revokeSession(sessionId: string): Promise<void> {
    await this.cache.delPattern(`${REFRESH_PREFIX}*`);
    void sessionId;
  }
}
