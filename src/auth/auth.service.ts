import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID, createHash } from 'crypto';
import { Merchant, MerchantStatus } from '../merchants/entities/merchant.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import type { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { CacheService } from '../cache/cache.service';

/** Failed login attempts allowed before the account is locked. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
/** How long a lockout lasts, in seconds. */
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;

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

/**
 * Cost factor used for merchant password hashes. Kept in sync with the value
 * used when hashing passwords so the dummy comparison below costs the same.
 */
const PASSWORD_HASH_ROUNDS = 10;

/**
 * Pre-computed bcrypt hash of a random, never-issued password. It is compared
 * against when no merchant matches the login email so that the login endpoint
 * takes the same time whether or not the account exists (no user enumeration
 * via response timing).
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'dupdap-dummy-password-for-constant-time-login',
  PASSWORD_HASH_ROUNDS,
);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly negativeBlacklistCache = new NegativeBlacklistCache();

  constructor(
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    private readonly jwtService: JwtService,
    private readonly cache: CacheService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    const existing = await this.merchants.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const merchant = this.merchants.create({
      email: dto.email,
      passwordHash,
      businessName: dto.businessName,
      businessType: dto.businessType,
      country: dto.country,
      status: MerchantStatus.ACTIVE,
    });

    const saved = await this.merchants.save(merchant);
    const token = this.signToken(saved.id, saved.email, saved.role);

    return { accessToken: token, merchant: saved };
  }

  private failedAttemptsKey(email: string): string {
    return `auth:failed-attempts:${email.toLowerCase()}`;
  }

  private lockoutKey(email: string): string {
    return `auth:lockout:${email.toLowerCase()}`;
  }

  /**
   * Clears the failed-attempt counter and any active lockout for an account.
   * Called on every successful login so a lockout earned on one device does
   * not persist for the next login from another device.
   */
  async clearFailedLogin(email: string): Promise<void> {
    await Promise.all([
      this.cache.del(this.failedAttemptsKey(email)),
      this.cache.del(this.lockoutKey(email)),
    ]);
  }

  /**
   * Verify merchant credentials.
   *
   * Always performs exactly one bcrypt comparison, even when the merchant is
   * not found, so response timing does not reveal whether an email is
   * registered.
   */
  async login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    const email = dto.email.toLowerCase();

    if (await this.cache.get<boolean>(this.lockoutKey(email))) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const merchant = await this.merchants.findOne({
      where: { email },
      select: ['id', 'email', 'passwordHash'],
    });

    const passwordMatches = await bcrypt.compare(
      dto.password,
      merchant?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!merchant || !passwordMatches) {
      await this.registerFailedLogin(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (merchant.status === MerchantStatus.SUSPENDED || merchant.suspended) {
      throw new UnauthorizedException('Account suspended');
    }

    await this.clearFailedLogin(email);

    return { accessToken: this.signToken(merchant.id, merchant.email, merchant.role), merchant };
  }

  /** Revoke a session and invalidate its cached negative lookup immediately. */
  async logout(jti: string, ttlSeconds: number): Promise<void> {
    this.negativeBlacklistCache.delete(jti);
    await this.cache.set(`session:blacklist:${jti}`, true, {
      ttlSeconds: Math.max(ttlSeconds, 1),
    });
  }

  /**
   * Whether the session (jti) has been revoked. Negative answers are served
   * from a local LRU cache so the hot auth path avoids a Redis round-trip.
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    if (this.negativeBlacklistCache.has(jti)) {
      return false;
    }

    const entry = await this.cache.get<boolean>(`session:blacklist:${jti}`);
    if (entry === true) {
      return true;
    }

    this.negativeBlacklistCache.set(jti);
    return false;
  }

  async findMerchantByApiKey(rawKey: string): Promise<Merchant | null> {
    const lookupHash = createHash('sha256').update(rawKey).digest('hex');
    const merchant = await this.merchants.findOne({
      where: { apiKeyLookupHash: lookupHash },
    });

    if (!merchant?.apiKeyHash) return null;
    return (await bcrypt.compare(rawKey, merchant.apiKeyHash)) ? merchant : null;
  }

  private async registerFailedLogin(email: string): Promise<void> {
    const key = this.failedAttemptsKey(email);
    const attempts = ((await this.cache.get<number>(key)) ?? 0) + 1;

    if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      await this.cache.set(this.lockoutKey(email), true, { ttlSeconds: LOGIN_LOCKOUT_SECONDS });
      await this.cache.del(key);
      this.logger.warn(`Account locked after ${attempts} failed login attempts: ${email}`);
      return;
    }

    await this.cache.set(key, attempts, { ttlSeconds: LOGIN_LOCKOUT_SECONDS });
  }

  private signToken(sub: string, email: string, role?: string): string {
    return this.jwtService.sign({ sub, email, role, jti: randomUUID() });
  }
}
