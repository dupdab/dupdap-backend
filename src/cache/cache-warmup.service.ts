import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AdminService } from '../admin/admin.service';
import { MerchantsService } from '../merchants/merchants.service';
import { StellarService } from '../stellar/stellar.service';

@Injectable()
export class CacheWarmupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CacheWarmupService.name);
  private warmed = false;

  constructor(
    private readonly stellarService: StellarService,
    private readonly adminService: AdminService,
    private readonly merchantsService: MerchantsService,
  ) {}

  /** Readiness probes must check this before reporting ready. */
  isWarmed(): boolean {
    return this.warmed;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      this.logger.log('Cache warm-up skipped in test environment');
      this.warmed = true;
      return;
    }

    const startedAt = Date.now();
    this.logger.log('Cache warm-up started');

    const tasks: Array<{ key: string; run: () => Promise<unknown> }> = [
      { key: 'exchange-rate:xlm-usd', run: () => this.stellarService.getXlmUsdRate() },
      { key: 'fee-config:platform:global', run: () => this.adminService.getGlobalFees() },
      { key: 'merchant:active:count', run: () => this.merchantsService.getActiveMerchantCount() },
      { key: 'merchant:config:top50', run: () => this.warmTopMerchants() },
    ];

    for (const task of tasks) {
      const keyStartedAt = Date.now();
      try {
        await task.run();
        this.logger.log(
          `Cache warm-up key=${task.key} durationMs=${Date.now() - keyStartedAt}`,
        );
      } catch (error) {
        this.logger.warn(
          `Cache warm-up failed key=${task.key} durationMs=${Date.now() - keyStartedAt} error=${String((error as Error)?.message ?? error)}`,
        );
      }
    }

    this.warmed = true;
    this.logger.log(
      `Cache warm-up completed durationMs=${Date.now() - startedAt}`,
    );
  }

  private async warmTopMerchants(): Promise<void> {
    const ids = await this.merchantsService.getTopMerchantIds(50);
    await Promise.allSettled(ids.map((id) => this.merchantsService.findOne(id)));
  }
}
