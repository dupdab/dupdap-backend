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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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

  async login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    const email = dto.email.toLowerCase();

    if (await this.cache.get<boolean>(this.lockoutKey(email))) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const merchant = await this.merchants.findOne({ where: { email } });
    const passwordMatches = merchant
      ? await bcrypt.compare(dto.password, merchant.passwordHash)
      : false;

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

  async logout(jti: string, ttlSeconds: number): Promise<void> {
    await this.cache.set(`session:blacklist:${jti}`, true, { ttlSeconds });
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const entry = await this.cache.get<boolean>(`session:blacklist:${jti}`);
    return entry === true;
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
