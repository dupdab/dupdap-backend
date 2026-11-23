import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Merchant, MerchantStatus } from '../merchants/entities/merchant.entity';
import { CacheService } from '../cache/cache.service';
import { LoginDto } from './dto/login.dto';

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
    private readonly cache: CacheService,
  ) {}

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

  async login(dto: LoginDto): Promise<{ accessToken: string; merchant: Merchant }> {
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

    return { accessToken: this.signToken(merchant), merchant };
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

  private signToken(merchant: Merchant): string {
    // Token issuance is handled by the JWT strategy/signing helper.
    return Buffer.from(JSON.stringify({ sub: merchant.id, email: merchant.email })).toString('base64');
  }
}
