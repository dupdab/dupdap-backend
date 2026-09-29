import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
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

/** Failed password attempts before a temporary lockout is applied. */
const LOGIN_MAX_FAILED_ATTEMPTS = 5;
/** Lockout / failed-attempt counter window (15 minutes). */
const LOGIN_LOCKOUT_TTL_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Merchant)
    private merchantsRepo: Repository<Merchant>,
    private jwtService: JwtService,
    private cacheService: CacheService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    const existing = await this.merchantsRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const merchant = this.merchantsRepo.create({
      email: dto.email,
      passwordHash,
      businessName: dto.businessName,
      businessType: dto.businessType,
      country: dto.country,
      status: MerchantStatus.ACTIVE,
    });

    const saved = await this.merchantsRepo.save(merchant);
    const token = this.signToken(saved.id, saved.email, saved.role);

    return { accessToken: token, merchant: saved };
  }

  async login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    const emailKey = dto.email.toLowerCase();
    await this.assertNotLockedOut(emailKey);

    const merchant = await this.merchantsRepo.findOne({ where: { email: dto.email } });
    if (!merchant) {
      await this.recordFailedLogin(emailKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, merchant.passwordHash);
    if (!valid) {
      await this.recordFailedLogin(emailKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (merchant.status === MerchantStatus.SUSPENDED) {
      throw new UnauthorizedException('Account suspended');
    }

    await this.clearFailedLogin(emailKey);

    const token = this.signToken(merchant.id, merchant.email, merchant.role);
    return { accessToken: token, merchant };
  }

  async logout(jti: string, ttlSeconds: number): Promise<void> {
    await this.cacheService.set(`session:blacklist:${jti}`, true, { ttlSeconds });
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const entry = await this.cacheService.get<boolean>(`session:blacklist:${jti}`);
    return entry === true;
  }

  async findMerchantByApiKey(rawKey: string): Promise<Merchant | null> {
    const lookupHash = createHash('sha256').update(rawKey).digest('hex');
    const merchant = await this.merchantsRepo.findOne({
      where: { apiKeyLookupHash: lookupHash },
    });

    if (!merchant?.apiKeyHash) return null;
    return (await bcrypt.compare(rawKey, merchant.apiKeyHash)) ? merchant : null;
  }

  private failedAttemptsKey(emailKey: string): string {
    return `auth:failed:${emailKey}`;
  }

  private lockoutKey(emailKey: string): string {
    return `auth:lockout:${emailKey}`;
  }

  private async assertNotLockedOut(emailKey: string): Promise<void> {
    const locked = await this.cacheService.get<boolean>(this.lockoutKey(emailKey));
    if (locked) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }
  }

  private async recordFailedLogin(emailKey: string): Promise<void> {
    const attemptsKey = this.failedAttemptsKey(emailKey);
    const current = (await this.cacheService.get<number>(attemptsKey)) ?? 0;
    const next = current + 1;

    if (next >= LOGIN_MAX_FAILED_ATTEMPTS) {
      await this.cacheService.set(this.lockoutKey(emailKey), true, {
        ttlSeconds: LOGIN_LOCKOUT_TTL_SECONDS,
      });
      await this.cacheService.del(attemptsKey);
      return;
    }

    await this.cacheService.set(attemptsKey, next, { ttlSeconds: LOGIN_LOCKOUT_TTL_SECONDS });
  }

  private async clearFailedLogin(emailKey: string): Promise<void> {
    await this.cacheService.del(this.failedAttemptsKey(emailKey));
  }

  private signToken(sub: string, email: string, role?: string): string {
    return this.jwtService.sign({ sub, email, role, jti: randomUUID() });
  }
}
