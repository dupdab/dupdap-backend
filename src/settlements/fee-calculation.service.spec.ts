import { FeeCalculationService, FEE_TIERS } from './fee-calculation.service';

describe('FeeCalculationService', () => {
  let service: FeeCalculationService;

  beforeEach(() => {
    service = new FeeCalculationService();
  });

  describe('resolveTier', () => {
    it('maps amounts to the correct tier at each boundary', () => {
      expect(service.resolveTier(0).name).toBe('standard');
      expect(service.resolveTier(9.999999).name).toBe('standard');
      expect(service.resolveTier(10).name).toBe('growth');
      expect(service.resolveTier(999.999999).name).toBe('growth');
      expect(service.resolveTier(1000).name).toBe('scale');
      expect(service.resolveTier(9999.999999).name).toBe('scale');
      expect(service.resolveTier(10000).name).toBe('enterprise');
      expect(service.resolveTier(1_000_000).name).toBe('enterprise');
    });

    it('falls back to the standard tier for unmapped amounts', () => {
      expect(service.resolveTier(-1).name).toBe('standard');
    });
  });

  describe('calculateFee', () => {
    it('computes fee and net for the standard tier', async () => {
      const result = await service.calculateFee('merchant-1', 5);
      expect(result.tierName).toBe('standard');
      expect(result.feeRate).toBe('0.015');
      expect(result.feeUsd).toBe('0.075000');
      expect(result.netUsd).toBe('4.925000');
    });

    it('computes fee and net at the growth tier lower boundary', async () => {
      const result = await service.calculateFee('merchant-1', 10);
      expect(result.tierName).toBe('growth');
      expect(result.feeRate).toBe('0.0125');
      expect(result.feeUsd).toBe('0.125000');
      expect(result.netUsd).toBe('9.875000');
    });

    it('computes fee and net at the scale tier lower boundary', async () => {
      const result = await service.calculateFee('merchant-1', 1000);
      expect(result.tierName).toBe('scale');
      expect(result.feeRate).toBe('0.01');
      expect(result.feeUsd).toBe('10.000000');
      expect(result.netUsd).toBe('990.000000');
    });

    it('computes fee and net at the enterprise tier lower boundary', async () => {
      const result = await service.calculateFee('merchant-1', 10000);
      expect(result.tierName).toBe('enterprise');
      expect(result.feeRate).toBe('0.0075');
      expect(result.feeUsd).toBe('75.000000');
      expect(result.netUsd).toBe('9925.000000');
    });

    it('covers every configured tier', async () => {
      for (const tier of FEE_TIERS) {
        const result = await service.calculateFee('merchant-1', tier.minUsd);
        expect(result.tierName).toBe(tier.name);
      }
    });
  });
});
