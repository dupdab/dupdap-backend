import { Injectable } from '@nestjs/common';

export interface FeeResult {
  feeUsd: number;
  feeRate: number;
  tierName: string;
  netUsd: number;
}

interface FeeTier {
  name: string;
  minUsd: number;
  maxUsd: number | null;
  rate: number;
}

const FEE_TIERS: FeeTier[] = [
  { name: 'standard', minUsd: 0, maxUsd: 1000, rate: 0.029 },
  { name: 'growth', minUsd: 1000, maxUsd: 10000, rate: 0.025 },
  { name: 'scale', minUsd: 10000, maxUsd: 100000, rate: 0.02 },
  { name: 'enterprise', minUsd: 100000, maxUsd: null, rate: 0.015 },
];

@Injectable()
export class FeeCalculationService {
  async calculateFee(merchantId: string, amountUsd: number): Promise<FeeResult> {
    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
      throw new Error(`Invalid amount for merchant ${merchantId}: ${amountUsd}`);
    }

    const tier = this.resolveTier(amountUsd);
    const feeUsd = this.round(amountUsd * tier.rate);
    const netUsd = this.round(amountUsd - feeUsd);

    return {
      feeUsd,
      feeRate: tier.rate,
      tierName: tier.name,
      netUsd,
    };
  }

  private resolveTier(amountUsd: number): FeeTier {
    for (const tier of FEE_TIERS) {
      if (amountUsd >= tier.minUsd && (tier.maxUsd === null || amountUsd < tier.maxUsd)) {
        return tier;
      }
    }
    return FEE_TIERS[FEE_TIERS.length - 1];
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
