import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SlippageConfig } from './entities/slippage-config.entity';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import { AuditService } from '../audit/audit.service';

export const SLIPPAGE_EXCEEDED_EVENT = 'slippage.exceeded';

export interface SlippageExceededPayload {
  expectedRate: string;
  actualRate: string;
  maxSlippageBps: number;
  actualSlippageBps: number;
}

/** Default max slippage: 100 bps = 1 % */
const DEFAULT_MAX_SLIPPAGE_BPS = 100;
/** Hard ceiling on any tolerance: 500 bps = 5 %. Overridable via RuntimeConfig. */
export const MAX_SLIPPAGE_CAP_KEY = 'blockchain_wallet.max_slippage_cap_bps';
export const DEFAULT_MAX_SLIPPAGE_CAP_BPS = 500;
const SINGLETON_KEY = 'global';

@Injectable()
export class SlippageService implements OnModuleInit {
  private readonly logger = new Logger(SlippageService.name);

  constructor(
    @InjectRepository(SlippageConfig)
    private readonly configRepo: Repository<SlippageConfig>,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly runtimeConfig?: RuntimeConfigService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /** Current cap on slippage tolerance in basis points (RuntimeConfig, default 500). */
  async getMaxSlippageCapBps(): Promise<number> {
    return (await this.runtimeConfig?.get<number>(MAX_SLIPPAGE_CAP_KEY, DEFAULT_MAX_SLIPPAGE_CAP_BPS))
      ?? DEFAULT_MAX_SLIPPAGE_CAP_BPS;
  }

  async onModuleInit(): Promise<void> {
    // Seed the singleton row if it doesn't exist yet
    const existing = await this.configRepo.findOne({ where: { key: SINGLETON_KEY } });
    if (!existing) {
      await this.configRepo.save(
        this.configRepo.create({ key: SINGLETON_KEY, maxSlippageBps: DEFAULT_MAX_SLIPPAGE_BPS }),
      );
      this.logger.log(`Seeded default max_slippage_bps = ${DEFAULT_MAX_SLIPPAGE_BPS}`);
    }
  }

  /**
   * Returns the effective max slippage tolerance in basis points, clamped to the cap
   * so a stored value above the cap (e.g. written before the cap existed) is never applied.
   */
  async getMaxSlippageBps(): Promise<number> {
    const row = await this.configRepo.findOne({ where: { key: SINGLETON_KEY } });
    const stored = row?.maxSlippageBps ?? DEFAULT_MAX_SLIPPAGE_BPS;
    return Math.min(stored, await this.getMaxSlippageCapBps());
  }

  /**
   * Admin function — update the max slippage tolerance.
   * @param bps  New threshold in basis points (0 to the current cap).
   * @throws BadRequestException when bps exceeds the cap.
   */
  async setMaxSlippage(bps: number): Promise<void> {
    if (bps < 0 || bps > 10_000) {
      throw new BadRequestException('maxSlippageBps must be between 0 and 10000');
    }

    const cap = await this.getMaxSlippageCapBps();
    if (bps > cap) {
      throw new BadRequestException(`maxSlippageBps ${bps} exceeds the cap of ${cap} bps`);
    }

    const row = await this.configRepo.findOne({ where: { key: SINGLETON_KEY } });
    if (!row) {
      await this.configRepo.save(
        this.configRepo.create({ key: SINGLETON_KEY, maxSlippageBps: bps }),
      );
    } else {
      row.maxSlippageBps = bps;
      await this.configRepo.save(row);
    }

    this.logger.log(`max_slippage_bps updated to ${bps}`);
  }

  /**
   * Superadmin override of the slippage cap. Every override is audited with its justification.
   * @param bps            New cap in basis points (0–10000).
   * @param justification  Required free-text reason, recorded in the audit log.
   */
  async overrideMaxSlippageCap(
    bps: number,
    justification: string,
    adminId: string,
    ip?: string,
  ): Promise<void> {
    if (bps < 0 || bps > 10_000) {
      throw new BadRequestException('maxSlippageCapBps must be between 0 and 10000');
    }
    if (!justification?.trim()) {
      throw new BadRequestException('justification is required');
    }
    if (!this.runtimeConfig || !this.auditService) {
      throw new BadRequestException('RuntimeConfig is unavailable; cannot override cap');
    }

    const before = await this.getMaxSlippageCapBps();
    await this.runtimeConfig.set(MAX_SLIPPAGE_CAP_KEY, bps, adminId, undefined, ip);
    await this.auditService.log({
      actor: adminId,
      action: 'slippage.cap_override',
      resource: `runtime-config:${MAX_SLIPPAGE_CAP_KEY}`,
      before: { value: before },
      after: { value: bps, justification: justification.trim() },
      ip,
    });
    this.logger.warn(`max_slippage_cap_bps overridden ${before} -> ${bps} by ${adminId}`);
  }

  /**
   * Check whether the actual swap rate deviates beyond the allowed threshold.
   *
   * Both rates are expressed as arbitrary-precision decimal strings
   * (e.g. "1.0523") so we avoid floating-point loss.
   *
   * Slippage bps = abs(expected - actual) / expected * 10_000
   *
   * @throws ForbiddenException when slippage exceeds the threshold.
   */
  async checkSlippage(expectedRate: string, actualRate: string): Promise<void> {
    const expected = parseFloat(expectedRate);
    const actual = parseFloat(actualRate);

    if (isNaN(expected) || expected === 0) {
      throw new BadRequestException('expectedRate must be a non-zero number');
    }
    if (isNaN(actual)) {
      throw new BadRequestException('actualRate must be a valid number');
    }

    const maxBps = await this.getMaxSlippageBps();
    const actualBps = Math.round((Math.abs(expected - actual) / expected) * 10_000);

    if (actualBps > maxBps) {
      const payload: SlippageExceededPayload = {
        expectedRate,
        actualRate,
        maxSlippageBps: maxBps,
        actualSlippageBps: actualBps,
      };

      this.eventEmitter.emit(SLIPPAGE_EXCEEDED_EVENT, payload);
      this.logger.warn(
        `SlippageExceeded: expected=${expectedRate} actual=${actualRate} ` +
          `slippage=${actualBps}bps max=${maxBps}bps`,
      );

      throw new ForbiddenException(
        `Swap rejected: slippage ${actualBps} bps exceeds max ${maxBps} bps`,
      );
    }
  }
}
