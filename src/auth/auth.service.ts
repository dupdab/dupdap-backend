import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Merchant, MerchantStatus } from '../merchants/entities/merchant.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import type { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { CacheService } from '../cache/cache.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Merchant)
    private merchantsRepo: Repository<Merchant>,
    private jwtService: JwtService,
    private cacheService: CacheService,
    private emailService: EmailService,
    private config: ConfigService,
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
    const merchant = await this.merchantsRepo.findOne({ where: { email: dto.email } });
    if (!merchant) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, merchant.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = this.signToken(merchant.id, merchant.email, merchant.role);
    return { accessToken: token, merchant };
  }

  async logout(jti: string, ttlSeconds: number): Promise<void> {
    await this.cacheService.set(`session:blacklist:${jti}`, true, { ttlSeconds });
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const merchant = await this.merchantsRepo.findOne({ where: { email } });
    if (!merchant) return { message: 'If that email exists, a reset link has been sent' };

    const token = randomBytes(32).toString('hex');
    merchant.passwordResetToken = this.hashToken(token);
    merchant.passwordResetExpiresAt = new Date(Date.now() + 3_600_000);
    await this.merchantsRepo.save(merchant);
    await this.emailService.queue(merchant.email, 'password-reset', {
      resetUrl: `${this.config.get('FRONTEND_URL')}/reset-password?token=${token}`,
    }, merchant.id);
    return { message: 'If that email exists, a reset link has been sent' };
  }

  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    const merchant = await this.merchantsRepo.findOne({ where: { passwordResetToken: this.hashToken(token) } });
    if (!merchant || !merchant.passwordResetExpiresAt || merchant.passwordResetExpiresAt <= new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    merchant.passwordHash = await bcrypt.hash(password, 12);
    merchant.passwordResetToken = null;
    merchant.passwordResetExpiresAt = null;
    await this.merchantsRepo.save(merchant);
    return { message: 'Password reset successfully' };
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const entry = await this.cacheService.get<boolean>(`session:blacklist:${jti}`);
    return entry === true;
  }

  async findMerchantByApiKey(rawKey: string): Promise<Merchant | null> {
    const merchants = await this.merchantsRepo.find({
      where: { apiKeyHash: Not(IsNull()) },
    });
    for (const m of merchants) {
      if (m.apiKeyHash && (await bcrypt.compare(rawKey, m.apiKeyHash))) {
        return m;
      }
    }
    return null;
  }

  private signToken(sub: string, email: string, role?: string): string {
    return this.jwtService.sign({ sub, email, role });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
