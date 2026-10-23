import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RuntimeConfig } from './entities/runtime-config.entity';
import { CacheService } from '../cache/cache.service';
import { AuditService } from '../audit/audit.service';

export const SETTLEMENT_CONFIG_DEFAULTS = {
  'settlements.small_batch_threshold_usd': 10,
  'settlements.batch_fee_rate': 0.015,
  'settlements.batch_window_minutes': 15,
  'settlements.large_settlement_threshold': 10000,
} as const;

@Injectable()
export class RuntimeConfigService {
  private readonly logger = new Logger(RuntimeConfigService.name);
  private readonly CACHE_PREFIX = 'runtime-config:';
  private readonly CACHE_TTL_SECONDS = 300;

  constructor(
    @InjectRepository(RuntimeConfig)
    private readonly configRepo: Repository<RuntimeConfig>,
    private readonly auditService: AuditService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    const cacheKey = `${this.CACHE_PREFIX}${key}`;

    // 1. Try Redis
    if (this.cacheService) {
      const cached = await this.cacheService.get<T>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    // 2. Try DB
    const config = await this.configRepo.findOne({ where: { key } });
    if (!config) {
      return defaultValue ?? (SETTLEMENT_CONFIG_DEFAULTS as Record<string, unknown>)[key] as T | undefined;
    }

    const value = config.value as T;

    // 3. Populate cache for subsequent reads
    if (this.cacheService) {
      await this.cacheService.set(cacheKey, value, { ttlSeconds: this.CACHE_TTL_SECONDS });
    }

    return value;
  }

  async set<T>(
    key: string,
    value: T,
    updatedBy: string,
    description?: string,
    ip?: string,
  ): Promise<RuntimeConfig> {
    let config = await this.configRepo.findOne({ where: { key } });
    const before = config ? config.value : undefined;

    if (config) {
      config.value = value;
      config.updatedBy = updatedBy;
      if (description !== undefined) config.description = description;
    } else {
      config = this.configRepo.create({ key, value, updatedBy, description });
    }

    const saved = await this.configRepo.save(config);
    await this.invalidate(key);
    await this.auditService.log({
      actor: updatedBy,
      action: 'runtime_config.update',
      resource: `runtime-config:${key}`,
      before: { value: before },
      after: { value },
      ip,
    });
    return saved;
  }

  async invalidate(key: string): Promise<void> {
    if (this.cacheService) {
      await this.cacheService.del(`${this.CACHE_PREFIX}${key}`);
    }
  }

  async getAll(): Promise<RuntimeConfig[]> {
    return this.configRepo.find();
  }
}
