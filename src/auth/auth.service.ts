import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { Merchant, MerchantStatus } from '../merchants/entities/merchant.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { CacheService } from '../cache/cache.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';

/** Failed password attempts before a temporary lockout is applied. */
const LOGIN_MAX_FAILED_ATTEMPTS = 5;
/** Lockout / failed-attempt counter window (15 minutes). */
const LOGIN_LOCKOUT_TTL_SECONDS = 15 * 60;
/** Password reset links are valid for 1 hour. */
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
/** Number of one-time recovery codes issued at registration. */
const RECOVERY_CODE_COUNT = 8;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Merchant)
    private merchantsRepo: Repository<Merchant>,
    private jwtService: JwtService,
    private cacheService: CacheService,
    @Optional() @InjectRepository(AuditLog) private auditLogRepo?: Repository<AuditLog>,
    @Optional() private readonly adminAlerts?: AdminAlertService,
    private emailService: EmailService,
    private auditService: AuditService,
    private notificationService: NotificationService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    const existing = await this.merchantsRepo.findOne({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(8).toString('hex'),
    );

    const merchant = this.merchantsRepo.create({
      email: dto.email,
      passwordHash,
      businessName: dto.businessName,
      businessType: dto.businessType,
      country: dto.country,
      status: MerchantStatus.ACTIVE,
      recoveryCodeHashes: recoveryCodes.map((code) => this.hashToken(code)),
    });

    const saved = await this.merchantsRepo.save(merchant);
    const token = this.signToken(saved.id, saved.email, saved.role);

    const unreadNotificationCount = await this.notificationService.getUnreadCount(saved.id);

    return { accessToken: token, merchant: saved, recoveryCodes, unreadNotificationCount };
  }

  /**
   * Emails a single-use reset link. Always resolves the same way whether or not
   * the email belongs to a merchant, so the endpoint cannot be used to enumerate accounts.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const merchant = await this.merchantsRepo.findOne({ where: { email: dto.email } });
    if (!merchant) return;

    const token = randomBytes(32).toString('hex');
    await this.cacheService.set(this.resetTokenKey(this.hashToken(token)), merchant.id, {
      ttlSeconds: PASSWORD_RESET_TTL_SECONDS,
    });

    await this.emailService.queue(
      merchant.email,
      'password-reset',
      {
        subject: 'Reset your DupDub password',
        merchantName: merchant.businessName,
        resetUrl: `https://app.dupdub.xyz/reset-password?token=${token}`,
        expiresInMinutes: PASSWORD_RESET_TTL_SECONDS / 60,
      },
      merchant.id,
    );
  }

  /**
   * Sets a new password using either an emailed reset token or an unused recovery code.
   * Both credentials are single-use.
   */
  async resetPassword(dto: ResetPasswordDto, ip?: string): Promise<void> {
    const usedRecoveryCode = !dto.token;
    const merchant = dto.token
      ? await this.consumeResetToken(dto.token)
      : await this.consumeRecoveryCode(dto.email, dto.recoveryCode);
    if (!merchant) throw new BadRequestException('Invalid or expired recovery credentials');

    merchant.passwordHash = await bcrypt.hash(dto.password, 12);
    await this.merchantsRepo.save(merchant);
    await this.clearFailedLogin(merchant.email.toLowerCase());

    await this.auditService.log({
      actor: merchant.id,
      action: 'PASSWORD_RESET',
      resource: `merchant:${merchant.id}`,
      after: { method: usedRecoveryCode ? 'recovery_code' : 'email_token' },
      ip,
    });
  }

  async login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    const emailKey = dto.email.toLowerCase();
    await this.assertNotLockedOut(emailKey);

    const merchant = await this.merchantsRepo.findOne({
      where: { email: dto.email },
    });
    if (!merchant) {
      await this.recordFailedLogin(emailKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, merchant.passwordHash);
    if (!valid) {
      await this.recordFailedLogin(emailKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (merchant.suspended || merchant.status === MerchantStatus.SUSPENDED) {
      throw new UnauthorizedException('Account suspended');
    }

    await this.clearFailedLogin(emailKey);

    const token = this.signToken(merchant.id, merchant.email, merchant.role);
    const unreadNotificationCount = await this.notificationService.getUnreadCount(merchant.id);

    return { accessToken: token, merchant, unreadNotificationCount };
  }

  async logout(jti: string, ttlSeconds: number): Promise<void> {
    await this.cacheService.set(`session:blacklist:${jti}`, true, {
      ttlSeconds,
    });
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

  async recordApiKeyUsageFromIp(merchant: Merchant, ip: string): Promise<void> {
    if (!ip || !this.auditLogRepo) return;
    const resource = `merchant:${merchant.id}:api-key`;
    const knownIp = await this.auditLogRepo.findOne({
      where: { resource, action: 'API_KEY_NEW_IP_USAGE', ip },
    });
    if (knownIp) return;
    await this.auditLogRepo.save({
      actor: merchant.id,
      action: 'API_KEY_NEW_IP_USAGE',
      resource,
      after: { keyPrefix: merchant.apiKeyLastFour, alert: true },
      ip,
    });
    await this.adminAlerts?.raise({
      type: AdminAlertType.API_KEY_NEW_IP,
      dedupeKey: `api-key-new-ip:${merchant.id}:${ip}`,
      message: `Merchant API key used from a new IP address: ${ip}`,
      metadata: { merchantId: merchant.id, ip, keyPrefix: merchant.apiKeyLastFour },
      thresholdValue: 1,
    });
  }

  async findMerchantById(id: string): Promise<Merchant | null> {
    return this.merchantsRepo.findOne({ where: { id } });
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

    await this.cacheService.set(attemptsKey, next, {
      ttlSeconds: LOGIN_LOCKOUT_TTL_SECONDS,
    });
  }

  private async clearFailedLogin(emailKey: string): Promise<void> {
    await this.cacheService.del(this.failedAttemptsKey(emailKey));
  }

  private resetTokenKey(tokenHash: string): string {
    return `auth:reset:${tokenHash}`;
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private async consumeResetToken(token: string): Promise<Merchant | null> {
    const key = this.resetTokenKey(this.hashToken(token));
    const merchantId = await this.cacheService.get<string>(key);
    if (!merchantId) return null;

    await this.cacheService.del(key);
    return this.merchantsRepo.findOne({ where: { id: merchantId } });
  }

  private async consumeRecoveryCode(email?: string, code?: string): Promise<Merchant | null> {
    if (!email || !code) return null;

    const merchant = await this.merchantsRepo.findOne({ where: { email } });
    const codeHash = this.hashToken(code);
    const hashes = merchant?.recoveryCodeHashes ?? [];
    if (!merchant || !hashes.includes(codeHash)) return null;

    merchant.recoveryCodeHashes = hashes.filter((hash) => hash !== codeHash);
    return merchant;
  }

  private signToken(sub: string, email: string, role?: string): string {
    return this.jwtService.sign({ sub, email, role, jti: randomUUID() });
  }
}
