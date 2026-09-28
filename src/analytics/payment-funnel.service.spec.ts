import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { MerchantAnalyticsService } from './merchant-analytics.service';
import { CacheService } from '../cache/cache.service';
import { Payment } from '../payments/entities/payment.entity';
import { Merchant } from '../merchants/entities/merchant.entity';

describe('MerchantAnalyticsService - Payment Funnel', () => {
  let service: MerchantAnalyticsService;
  let mockDataSource: any;
  let mockPaymentsRepo: any;
  let mockMerchantsRepo: any;
  let paymentsQb: any;
  let getRawOne: jest.Mock;
  let cache: { getOrSet: jest.Mock };

  beforeEach(async () => {
    mockDataSource = {
      query: jest.fn(),
    };

    paymentsQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
    };
    getRawOne = jest.fn();
    paymentsQb.getRawOne = getRawOne;

    mockPaymentsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(paymentsQb),
    };

    mockMerchantsRepo = {};

    const store = new Map<string, unknown>();
    cache = {
      getOrSet: jest.fn(async (key: string, fetchFn: () => Promise<unknown>) => {
        if (store.has(key)) return { value: store.get(key), cacheHit: true };
        const value = await fetchFn();
        store.set(key, value);
        return { value, cacheHit: false };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantAnalyticsService,
        {
          provide: getDataSourceToken(),
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentsRepo,
        },
        {
          provide: getRepositoryToken(Merchant),
          useValue: mockMerchantsRepo,
        },
        {
          provide: CacheService,
          useValue: cache,
        },
      ],
    }).compile();

    service = module.get<MerchantAnalyticsService>(MerchantAnalyticsService);
  });

  it('should calculate payment funnel correctly', async () => {
    getRawOne.mockResolvedValue({
      created: '100',
      confirmed: '80',
      settling: '70',
      settled: '65',
      failed: '15',
      expired: '5',
    });

    const result = await service.getPaymentFunnel();

    expect(mockPaymentsRepo.createQueryBuilder).toHaveBeenCalledWith('p');
    expect(getRawOne).toHaveBeenCalledTimes(1);
    expect(mockDataSource.query).not.toHaveBeenCalled();

    expect(result.totalCreated).toBe(100);
    expect(result.stages).toHaveLength(4);

    // Check created stage
    expect(result.stages[0]).toEqual({
      stage: 'created',
      count: 100,
      percentage: 100,
    });

    // Check confirmed stage
    expect(result.stages[1]).toEqual({
      stage: 'confirmed',
      count: 80,
      percentage: 80,
      dropOffCount: 20,
      dropOffPercentage: 20,
    });

    // Check settling stage
    expect(result.stages[2]).toEqual({
      stage: 'settling',
      count: 70,
      percentage: 70,
      dropOffCount: 10,
      dropOffPercentage: 12.5,
    });

    // Check settled stage
    expect(result.stages[3]).toEqual({
      stage: 'settled',
      count: 65,
      percentage: 65,
      dropOffCount: 5,
      dropOffPercentage: 7.14,
    });
  });

  it('should handle network filter', async () => {
    getRawOne.mockResolvedValue({
      created: '50',
      confirmed: '40',
      settling: '35',
      settled: '30',
      failed: '8',
      expired: '2',
    });

    const result = await service.getPaymentFunnel(
      '2024-01-01',
      '2024-01-31',
      'stellar',
    );

    expect(mockPaymentsRepo.createQueryBuilder).toHaveBeenCalledWith('p');
    expect(paymentsQb.andWhere).toHaveBeenCalledWith('p.network = :network', {
      network: 'stellar',
    });
    expect(getRawOne).toHaveBeenCalledTimes(1);
    expect(mockDataSource.query).not.toHaveBeenCalled();
    expect(result.network).toBe('stellar');
    expect(result.totalCreated).toBe(50);
  });
});
