import { Injectable, BadRequestException } from '@nestjs/common';
import Big from 'big.js';
import { MerchantsService } from '../merchants/merchants.service';

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
  constructor(private readonly merchantsService: MerchantsService) {}

  async calculateFee(merchantId: string, amountUsd: string | number): Promise<FeeResult> {
    let amount: Big;
    try {
      amount = new Big(amountUsd);
    } catch {
      throw new BadRequestException(`Invalid amount for merchant ${merchantId}: ${amountUsd}`);
    }
    if (amount.lt(0)) {
      throw new BadRequestException(`Invalid amount for merchant ${merchantId}: ${amountUsd}`);
    }

    const merchant = await this.merchantsService.findOne(merchantId);
    const tier = this.resolveTier(amount);
    // Merchant override wins; null means the tier default applies.
    const rate = merchant.customFeeRate != null ? new Big(merchant.customFeeRate) : new Big(tier.rate);
    const feeUsd = this.round(amount.times(rate));
    const netUsd = this.round(amount.minus(feeUsd));

    return {
      feeUsd: feeUsd.toNumber(),
      feeRate: rate.toNumber(),
      tierName: tier.name,
      netUsd: netUsd.toNumber(),
    };
  }

  private resolveTier(amount: Big): FeeTier {
    for (const tier of FEE_TIERS) {
      if (amount.gte(tier.minUsd) && (tier.maxUsd === null || amount.lt(tier.maxUsd))) {
        return tier;
      }
    }
    return FEE_TIERS[FEE_TIERS.length - 1];
  }

  private round(value: Big): Big {
    return value.round(2, Big.roundHalfUp);
  }
}
