import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import Big from 'big.js';
import { Merchant, MerchantStatus, SettlementFrequency } from './entities/merchant.entity';
import { ApiScope, API_KEY_SCOPES } from '../auth/scopes';
import { UpdateMerchantDto } from './dto/create-merchant.dto';
import { UpdateTransactionLimitsDto } from './dto/update-transaction-limits.dto';
import { CacheService } from '../cache/cache.service';
import { AuditLog } from '../audit/entities/audit-log.entity';

/** Maximum allowed API key lifetime in milliseconds (365 days). */
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class MerchantsService {
  private readonly activeMerchantCountCacheKey = 'merchant:active:count';
  private readonly activeMerchantCountTtlSeconds = 300;

  constructor(
    @InjectRepository(Merchant)
    private merchantsRepo: Repository<Merchant>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    private readonly cache: CacheService,
  ) {}

  async getActiveMerchantCount(): Promise<number> {
    const { value } = await this.cache.getOrSet<number>(
      this.activeMerchantCountCacheKey,
      () => this.merchantsRepo.count({ where: { status: MerchantStatus.ACTIVE } }),
      { ttlSeconds: this.activeMerchantCountTtlSeconds },
    );
    return value;
  }

  /** Top merchant IDs for cache warmup (ordered by creation, capped). */
  async getTopMerchantIds(limit = 50): Promise<string[]> {
    const merchants = await this.merchantsRepo.find({
      where: { status: MerchantStatus.ACTIVE },
      select: ['id'],
      order: { createdAt: 'ASC' },
      take: limit,
    });
    return merchants.map((m) => m.id);
  }

  async findOne(id: string): Promise<Merchant> {
    const merchant = await this.merchantsRepo.findOne({ where: { id } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    return merchant;
  }

  async update(id: string, dto: UpdateMerchantDto): Promise<Merchant> {
    const merchant = await this.findOne(id);

    const before = this.toAuditSnapshot(merchant);

    if (dto.businessName !== undefined) merchant.businessName = dto.businessName;
    if (dto.businessType !== undefined) merchant.businessType = dto.businessType;
    if (dto.country !== undefined) merchant.country = dto.country;
    if (dto.bankAccountNumber !== undefined) merchant.bankAccountNumber = dto.bankAccountNumber;
    if (dto.bankCode !== undefined) merchant.bankCode = dto.bankCode;
    if (dto.bankName !== undefined) merchant.bankName = dto.bankName;

    const updated = await this.merchantsRepo.save(merchant);
    await this.cache.del(this.activeMerchantCountCacheKey);

    // Audit every merchant settings change (#543). Sensitive bank account
    // numbers are masked; never persisted in cleartext in the log.
    const after = this.toAuditSnapshot(updated);
    await this.auditLogRepo.save({
      actor: id,
      action: 'MERCHANT_SETTINGS_UPDATED',
      resource: `merchant:${id}`,
      before,
      after,
    });

    return updated;
  }

  /** Auditable merchant settings snapshot with bank account masked. */
  private toAuditSnapshot(m: Merchant): Record<string, unknown> {
    return {
      businessName: m.businessName ?? null,
      businessType: m.businessType ?? null,
      country: m.country ?? null,
      bankAccountNumber: m.bankAccountNumber
        ? `****${String(m.bankAccountNumber).slice(-4)}`
        : null,
      bankCode: m.bankCode ?? null,
      bankName: m.bankName ?? null,
    };
  }

  /** Paginated audit log for the merchant's own settings changes (#543). */
  async getAuditLog(merchantId: string, page = 1, limit = 20) {
    const [items, total] = await this.auditLogRepo.findAndCount({
      where: { resource: `merchant:${merchantId}` },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const mapped = items.map((e) => ({
      actorId: (e as unknown as Record<string, unknown>).actor,
      action: (e as unknown as Record<string, unknown>).action,
      before: (e as unknown as Record<string, unknown>).before,
      after: (e as unknown as Record<string, unknown>).after,
      timestamp: (e as unknown as Record<string, unknown>).createdAt,
    }));
    return { items: mapped, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async generateApiKey(
    id: string,
    scopes?: ApiScope[],
    expiresAt?: Date,
  ): Promise<{ apiKey: string; expiresAt: Date | null }> {
    if (expiresAt != null) {
      const maxExpiry = new Date(Date.now() + MAX_EXPIRY_MS);
      if (expiresAt <= new Date()) {
        throw new BadRequestException('expiresAt must be in the future');
      }
      if (expiresAt > maxExpiry) {
        throw new BadRequestException('expiresAt must not be more than 1 year from now');
      }
    }

    const merchant = await this.findOne(id);
    const rawKey = `cpk_${crypto.randomBytes(32).toString('hex')}`;
    const hash = await bcrypt.hash(rawKey, 10);

    merchant.apiKey = rawKey.substring(0, 12) + '...';
    merchant.apiKeyHash = hash;
    merchant.apiKeyLookupHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    merchant.apiKeyScopes = scopes?.length ? scopes : API_KEY_SCOPES;
    merchant.apiKeyExpiresAt = expiresAt ?? null;
    // Reset the reminder flag whenever a new key is issued
    merchant.apiKeyExpirySentAt = null;
    await this.merchantsRepo.save(merchant);

    return { apiKey: rawKey, expiresAt: merchant.apiKeyExpiresAt };
  }

  /**
   * Admin operation: extend the expiry of an existing API key.
   * Resets the 14-day reminder flag and writes an audit log entry.
   */
  async extendApiKeyExpiry(
    merchantId: string,
    newExpiresAt: Date,
    adminId: string,
  ): Promise<Merchant> {
    const maxExpiry = new Date(Date.now() + MAX_EXPIRY_MS);
    if (newExpiresAt <= new Date()) {
      throw new BadRequestException('newExpiresAt must be in the future');
    }
    if (newExpiresAt > maxExpiry) {
      throw new BadRequestException('newExpiresAt must not be more than 1 year from now');
    }

    const merchant = await this.findOne(merchantId);
    const previousExpiresAt = merchant.apiKeyExpiresAt;

    merchant.apiKeyExpiresAt = newExpiresAt;
    // Reset so the merchant gets a fresh 14-day warning before the new expiry
    merchant.apiKeyExpirySentAt = null;
    await this.merchantsRepo.save(merchant);

    await this.auditLogRepo.save({
      actor: adminId,
      action: 'api_key_expiry_extended',
      resourceType: 'merchant',
      resourceId: merchantId,
      details: {
        previousExpiresAt: previousExpiresAt?.toISOString() ?? null,
        newExpiresAt: newExpiresAt.toISOString(),
      },
    });

    return merchant;
  }

  async getProfile(id: string) {
    return this.findOne(id);
  }

  async updateMerchantFee(
    merchantId: string,
    customFeeRate: number | null,
  ): Promise<Merchant> {
    const merchant = await this.merchantsRepo.findOne({ where: { id: merchantId } });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    merchant.customFeeRate = customFeeRate != null ? String(customFeeRate) : null;
    const updated = await this.merchantsRepo.save(merchant);
    await this.cache.del(this.activeMerchantCountCacheKey);
    return updated;
  }

  /**
   * Admin operation: update a merchant's per-transaction and daily USD limits (#500).
   * Writes an audit log entry with the previous and new values.
   */
  async updateTransactionLimits(
    merchantId: string,
    dto: UpdateTransactionLimitsDto,
    adminId: string,
  ): Promise<Merchant> {
    const merchant = await this.findOne(merchantId);
    const previous = {
      singleTransactionLimitUsd: merchant.singleTransactionLimitUsd,
      dailyLimitUsd: merchant.dailyLimitUsd,
    };

    if (dto.singleTransactionLimitUsd !== undefined) {
      merchant.singleTransactionLimitUsd = String(dto.singleTransactionLimitUsd);
    }
    if (dto.dailyLimitUsd !== undefined) {
      merchant.dailyLimitUsd = String(dto.dailyLimitUsd);
    }
    if (new Big(merchant.singleTransactionLimitUsd).gt(merchant.dailyLimitUsd)) {
      throw new BadRequestException('singleTransactionLimitUsd must not exceed dailyLimitUsd');
    }

    const updated = await this.merchantsRepo.save(merchant);

    await this.auditLogRepo.save({
      actor: adminId,
      action: 'merchant_transaction_limits_updated',
      resourceType: 'merchant',
      resourceId: merchantId,
      details: {
        previous,
        singleTransactionLimitUsd: updated.singleTransactionLimitUsd,
        dailyLimitUsd: updated.dailyLimitUsd,
      },
    });

    return updated;
  }

  async verifyMerchant(id: string): Promise<Merchant> {
    const merchant = await this.findOne(id);
    merchant.status = MerchantStatus.ACTIVE;
    return this.merchantsRepo.save(merchant);
  }

  async updateSettlementPreference(
    id: string,
    settlementFrequency: SettlementFrequency,
  ): Promise<Merchant> {
    const merchant = await this.findOne(id);
    merchant.settlementFrequency = settlementFrequency;
    return this.merchantsRepo.save(merchant);
  }
}
