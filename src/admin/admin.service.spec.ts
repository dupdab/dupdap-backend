import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { AdminService } from './admin.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Merchant, MerchantStatus, MerchantRole } from '../merchants/entities/merchant.entity';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
import { Settlement } from '../settlements/entities/settlement.entity';
import { FeeConfig, FeeType } from '../fee-config/entities/fee-config.entity';
import { FeeHistory, FeeChangeType } from '../fee-config/entities/fee-history.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { FilterService } from '../common/filter.service';
import { CacheService } from '../cache/cache.service';
import { StellarMonitorService } from '../stellar/stellar-monitor.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeQb(overrides: Partial<Record<string, jest.Mock>> = {}): Record<string, jest.Mock> {
  const qb: Record<string, jest.Mock> = {
    select: jest.fn(),
    addSelect: jest.fn(),
    innerJoin: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    having: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    limit: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    setParameter: jest.fn(),
    getRawMany: jest.fn(),
    getRawOne: jest.fn(),
    getMany: jest.fn(),
    getManyAndCount: jest.fn(),
    ...overrides,
  };
  Object.keys(qb).forEach((k) => {
    if (!['getRawMany', 'getRawOne', 'getMany', 'getManyAndCount'].includes(k)) {
      qb[k].mockReturnValue(qb);
    }
  });
  return qb;
}

const mockRepository = () => ({
  findAndCount: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((x) => x),
  remove: jest.fn(),
  softRemove: jest.fn(),
  delete: jest.fn(),
  softDelete: jest.fn(),
  restore: jest.fn(),
  createQueryBuilder: jest.fn(),
});

// ─── Module setup ───────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminService;
  let merchantsRepo: ReturnType<typeof mockRepository>;
  let paymentsRepo: ReturnType<typeof mockRepository>;
  let settlementsRepo: ReturnType<typeof mockRepository>;
  let feeConfigRepo: ReturnType<typeof mockRepository>;
  let feeHistoryRepo: ReturnType<typeof mockRepository>;
  let auditLogRepo: ReturnType<typeof mockRepository>;
  let cacheService: { getOrSet: jest.Mock; del: jest.Mock; delPattern: jest.Mock };

  beforeEach(async () => {
    cacheService = {
      getOrSet: jest.fn().mockImplementation(async (_key, fn) => {
        const value = await fn();
        return { value, cacheHit: false };
      }),
      del: jest.fn().mockResolvedValue(1),
      delPattern: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        FilterService,
        { provide: getRepositoryToken(Merchant), useFactory: mockRepository },
        { provide: getRepositoryToken(Payment), useFactory: mockRepository },
        { provide: getRepositoryToken(Settlement), useFactory: mockRepository },
        {
          provide: getRepositoryToken(FeeConfig),
          useValue: { find: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(FeeHistory),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
        { provide: getRepositoryToken(AuditLog), useFactory: mockRepository },
        { provide: CacheService, useValue: cacheService },
        {
          provide: StellarMonitorService,
          useValue: {
            getLastRunStatus: jest.fn().mockReturnValue({ status: 'idle', lastRunAt: null, lastError: null }),
          },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    merchantsRepo = module.get(getRepositoryToken(Merchant));
    paymentsRepo = module.get(getRepositoryToken(Payment));
    settlementsRepo = module.get(getRepositoryToken(Settlement));
    feeConfigRepo = module.get(getRepositoryToken(FeeConfig));
    feeHistoryRepo = module.get(getRepositoryToken(FeeHistory));
    auditLogRepo = module.get(getRepositoryToken(AuditLog));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── findAllMerchants ──────────────────────────────────────────────────────

  describe('findAllMerchants', () => {
    it('should return paginated merchants with default values', async () => {
      const merchants = [{ id: '1', email: 'm1@test.com', passwordHash: 'hash' }];
      merchantsRepo.findAndCount.mockResolvedValue([merchants, 1]);

      const result = await service.findAllMerchants();
      expect(result.merchants).toHaveLength(1);
      expect(merchantsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('should return paginated merchants with custom values', async () => {
      const merchants = [{ id: '1', email: 'm1@test.com', passwordHash: 'hash' }];
      merchantsRepo.findAndCount.mockResolvedValue([merchants, 1]);

      await service.findAllMerchants(2, 10);
      expect(merchantsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  // ── findOneMerchant ───────────────────────────────────────────────────────

  describe('findOneMerchant', () => {
    it('should return a merchant if found', async () => {
      const merchant = { id: '1', email: 'm1@test.com' };
      merchantsRepo.findOne.mockResolvedValue(merchant);

      const result = await service.findOneMerchant('1');
      expect(result).toEqual(merchant);
    });

    it('should throw NotFoundException if merchant not found', async () => {
      merchantsRepo.findOne.mockResolvedValue(null);
      await expect(service.findOneMerchant('1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateMerchantStatus ──────────────────────────────────────────────────

  describe('updateMerchantStatus', () => {
    it('should update and return merchant status', async () => {
      const merchant = { id: '1', status: MerchantStatus.PENDING };
      merchantsRepo.findOne.mockResolvedValue(merchant);
      merchantsRepo.save.mockResolvedValue({ ...merchant, status: MerchantStatus.ACTIVE });

      const result = await service.updateMerchantStatus('1', MerchantStatus.ACTIVE);
      expect(result.status).toBe(MerchantStatus.ACTIVE);
    });

    it('should throw NotFoundException if merchant not found', async () => {
      merchantsRepo.findOne.mockResolvedValue(null);
      await expect(service.updateMerchantStatus('1', MerchantStatus.ACTIVE)).rejects.toThrow(NotFoundException);
    });
  });

  // ── bulkUpdateMerchantStatus ──────────────────────────────────────────────

  describe('bulkUpdateMerchantStatus', () => {
    it('should handle partial failures', async () => {
      merchantsRepo.findOne
        .mockResolvedValueOnce({ id: '1', status: MerchantStatus.PENDING })
        .mockResolvedValueOnce(null);

      const result = await service.bulkUpdateMerchantStatus(['1', '2'], MerchantStatus.ACTIVE);

      expect(result.success).toContain('1');
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe('2');
      expect(result.failed[0].error).toBe('Merchant not found');
    });

    it('should succeed for all when all exist', async () => {
      merchantsRepo.findOne.mockResolvedValue({ id: 'any', status: MerchantStatus.PENDING });
      merchantsRepo.save.mockResolvedValue({ status: MerchantStatus.ACTIVE });

      const result = await service.bulkUpdateMerchantStatus(['1', '2'], MerchantStatus.ACTIVE);
      expect(result.success).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });
  });

  // ── getGlobalStats ────────────────────────────────────────────────────────

  describe('getGlobalStats', () => {
    it('should return aggregated stats', async () => {
      const qb = makeQb({
        getRawMany: jest.fn()
          .mockResolvedValueOnce([{ status: 'settled', count: '5', totalUsd: '500' }])
          .mockResolvedValueOnce([{ status: 'active', count: '2' }]),
      });
      paymentsRepo.createQueryBuilder.mockReturnValue(qb);
      merchantsRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getGlobalStats();
      expect(result.payments).toHaveLength(1);
      expect(result.merchants).toHaveLength(1);
    });
  });

  // ── Fee Management ────────────────────────────────────────────────────────

  describe('Fee Management', () => {
    it('should return all global fees', async () => {
      const fees = [
        { feeType: FeeType.TRANSFER, baseFeeRate: '0.010000' },
        { feeType: FeeType.WITHDRAWAL, baseFeeRate: '0.020000' },
      ];
      feeConfigRepo.find.mockResolvedValue(fees);

      const result = await service.getGlobalFees();
      expect(result).toEqual(fees);
      expect(feeConfigRepo.find).toHaveBeenCalledWith({ order: { feeType: 'ASC' } });
    });

    it('should update global fee and record history', async () => {
      const feeConfig = { feeType: FeeType.TRANSFER, baseFeeRate: '0.010000' };
      feeConfigRepo.findOne.mockResolvedValue(feeConfig);
      feeConfigRepo.save.mockResolvedValue({ ...feeConfig, baseFeeRate: '0.015000' });
      feeHistoryRepo.create.mockReturnValue({});
      feeHistoryRepo.save.mockResolvedValue({});

      await service.updateGlobalFee(
        FeeType.TRANSFER,
        '0.015000',
        'admin-123',
        'Increased due to market conditions',
      );

      expect(feeConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ baseFeeRate: '0.015000' }),
      );
      expect(feeHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          feeType: FeeType.TRANSFER,
          changeType: FeeChangeType.GLOBAL,
          previousValue: '0.010000',
          newValue: '0.015000',
          actorId: 'admin-123',
          reason: 'Increased due to market conditions',
        }),
      );
      expect(feeHistoryRepo.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException when fee config not found', async () => {
      feeConfigRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateGlobalFee(FeeType.DEPOSIT, '0.005000', 'admin-123'),
      ).rejects.toThrow('Fee config for deposit not found');
    });
  });

  // ── Audit Trail (#207) ────────────────────────────────────────────────────

  describe('audit logging for state-mutating actions', () => {
    const expectAuditLog = (match: Record<string, any>) => {
      expect(auditLogRepo.save).toHaveBeenCalledWith(expect.objectContaining(match));
    };

    it('updateMerchantStatus writes an audit log', async () => {
      merchantsRepo.findOne.mockResolvedValue({ id: 'm1', status: MerchantStatus.PENDING });
      merchantsRepo.save.mockResolvedValue({});

      await service.updateMerchantStatus('m1', MerchantStatus.ACTIVE, 'admin-1');

      expectAuditLog({
        actor: 'admin-1',
        action: 'MERCHANT_STATUS_UPDATED',
        resource: 'merchant:m1',
      });
    });

    it('bulkUpdateMerchantStatus writes an audit log per merchant', async () => {
      merchantsRepo.findOne.mockResolvedValue({ id: 'x', status: MerchantStatus.PENDING });
      merchantsRepo.save.mockResolvedValue({});

      await service.bulkUpdateMerchantStatus(['m1', 'm2'], MerchantStatus.ACTIVE, 'admin-1');

      expect(auditLogRepo.save).toHaveBeenCalledTimes(2);
    });

    it('createAdmin writes an audit log', async () => {
      merchantsRepo.save.mockResolvedValue({ id: 'a1', email: 'a@test.com' });

      await service.createAdmin('a@test.com', 'pw', 'Biz', MerchantRole.SUPERADMIN, 'admin-1');

      expectAuditLog({ action: 'ADMIN_CREATED', resource: 'admin:a1' });
    });

    it('deleteAdmin writes an audit log', async () => {
      merchantsRepo.findOne.mockResolvedValue({ id: 'a1', role: MerchantRole.ADMIN, email: 'a@test.com' });

      await service.deleteAdmin('a1', MerchantRole.SUPERADMIN, 'admin-1');

      expectAuditLog({ action: 'ADMIN_DELETED', resource: 'admin:a1' });
      expect(merchantsRepo.softRemove).toHaveBeenCalled();
    });

    it('prevents an ADMIN from escalating a role', async () => {
      await expect(service.updateAdminRole('target', MerchantRole.SUPERADMIN, MerchantRole.ADMIN, 'admin-1'))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(merchantsRepo.findOne).not.toHaveBeenCalled();
    });

    it('rejects assigning a merchant role through admin role management', async () => {
      await expect(service.updateAdminRole('target', MerchantRole.MERCHANT, MerchantRole.SUPERADMIN, 'root'))
        .rejects.toThrow('Role must be ADMIN or SUPERADMIN');
      expect(merchantsRepo.findOne).not.toHaveBeenCalled();
    });

    it('toggleSandboxMode writes an audit log', async () => {
      merchantsRepo.findOne.mockResolvedValue({ id: 'm1' });
      merchantsRepo.save.mockResolvedValue({});

      await service.toggleSandboxMode('m1', true, 'admin-1');

      expectAuditLog({ action: 'SANDBOX_MODE_TOGGLED', resource: 'merchant:m1' });
    });

    it('resetSandboxData writes an audit log', async () => {
      merchantsRepo.findOne.mockResolvedValue({ id: 'm1' });
      paymentsRepo.find.mockResolvedValue([{ id: 'p1' }]);

      await service.resetSandboxData('m1', 'admin-1');

      expectAuditLog({ action: 'DATA_PURGED', resource: 'merchant:m1' });
    });

    it('restoreRecord writes an audit log', async () => {
      merchantsRepo.findOne.mockResolvedValue({ id: 'm1', deletedAt: new Date() });

      await service.restoreRecord('merchants', 'm1', 'admin-1');

      expectAuditLog({ action: 'RECORD_RESTORED', resource: 'merchants:m1' });
    });

    it('deleteRecord writes a soft-delete audit log', async () => {
      merchantsRepo.findOne.mockResolvedValue({ id: 'm1' });

      await service.deleteRecord('merchants', 'm1', false, MerchantRole.ADMIN, 'admin-1');

      expectAuditLog({ action: 'RECORD_DELETED', resource: 'merchants:m1' });
    });

    it('deleteRecord writes a hard-delete audit log', async () => {
      merchantsRepo.findOne.mockResolvedValue({ id: 'm1' });

      await service.deleteRecord('merchants', 'm1', true, MerchantRole.SUPERADMIN, 'admin-1');

      expectAuditLog({ action: 'RECORD_HARD_DELETED', resource: 'merchants:m1' });
    });
  });

  // ── getTopMerchants ───────────────────────────────────────────────────────

  describe('getTopMerchants', () => {
    function makeMerchantsQb(rows: Record<string, string>[]) {
      const qb = makeQb({ getRawMany: jest.fn().mockResolvedValue(rows) });
      paymentsRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    const sampleRows = [
      {
        merchantId: 'uuid-merchant-1',
        businessName: 'Acme Corp',
        country: 'US',
        totalVolume: '50000.000000',
        paymentCount: '200',
        eligibleCount: '210',
      },
      {
        merchantId: 'uuid-merchant-2',
        businessName: 'Beta Ltd',
        country: 'GB',
        totalVolume: '30000.000000',
        paymentCount: '120',
        eligibleCount: '130',
      },
    ];

    it('returns data shaped as TopMerchantsResponseDto', async () => {
      makeMerchantsQb(sampleRows);

      const result = await service.getTopMerchants({ limit: 10, period: '30d' });

      expect(result.data).toHaveLength(2);
      expect(result.period).toBe('30d');
      expect(result.periodStart).toBeDefined();
      expect(result.periodEnd).toBeDefined();
      expect(result.nextCursor).toBeNull();
    });

    it('maps fields correctly for each item', async () => {
      makeMerchantsQb([sampleRows[0]]);

      const result = await service.getTopMerchants({ limit: 10, period: '30d' });
      const item = result.data[0];

      expect(item.merchantId).toBe('uuid-merchant-1');
      expect(item.name).toBe('Acme Corp');
      expect(item.country).toBe('US');
      expect(item.totalVolume).toBe('50000.000000');
      expect(item.paymentCount).toBe(200);
      expect(item.avgOrderValue).toBe('250.000000');
      expect(item.successRate).toBeCloseTo(95.24, 1);
    });

    it('sets avgOrderValue to 0.000000 when paymentCount is 0', async () => {
      makeMerchantsQb([{ ...sampleRows[0], paymentCount: '0', eligibleCount: '0' }]);

      const result = await service.getTopMerchants({ limit: 10, period: '30d' });
      expect(result.data[0].avgOrderValue).toBe('0.000000');
      expect(result.data[0].successRate).toBe(0);
    });

    it('returns nextCursor when there are more results than limit', async () => {
      const extraRows = Array.from({ length: 3 }, (_, i) => ({
        merchantId: `uuid-${i}`,
        businessName: `Merchant ${i}`,
        country: 'US',
        totalVolume: `${(3 - i) * 10000}.000000`,
        paymentCount: '50',
        eligibleCount: '55',
      }));
      makeMerchantsQb(extraRows);

      const result = await service.getTopMerchants({ limit: 2, period: '30d' });

      expect(result.data).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();

      const decoded = JSON.parse(Buffer.from(result.nextCursor!, 'base64').toString('utf8'));
      expect(decoded.id).toBe('uuid-1');
      expect(decoded.volume).toBe('20000.000000');
    });

    it('uses cursor when provided', async () => {
      const cursor = Buffer.from(JSON.stringify({ id: 'uuid-prev', volume: '99999.000000' })).toString('base64');
      const qb = makeMerchantsQb(sampleRows);

      await service.getTopMerchants({ limit: 10, period: '30d', cursor });

      expect(qb.having).toHaveBeenCalled();
      const havingCall = qb.having.mock.calls[0];
      expect(havingCall[0]).toContain('cursorVolume');
      expect(havingCall[1]).toMatchObject({ cursorVolume: 99999, cursorId: 'uuid-prev' });
    });

    it('defaults to period=30d when not specified', async () => {
      makeMerchantsQb([]);
      const result = await service.getTopMerchants({});
      expect(result.period).toBe('30d');
    });

    it('respects period=7d and sets a ~7-day window', async () => {
      makeMerchantsQb([]);
      const result = await service.getTopMerchants({ period: '7d' });

      const start = new Date(result.periodStart).getTime();
      const end = new Date(result.periodEnd).getTime();

      expect(end - start).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 1000);
      expect(end - start).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 1000);
    });

    it('respects period=90d', async () => {
      makeMerchantsQb([]);
      const result = await service.getTopMerchants({ period: '90d' });
      const start = new Date(result.periodStart).getTime();
      const end = new Date(result.periodEnd).getTime();
      expect(end - start).toBeGreaterThanOrEqual(90 * 24 * 60 * 60 * 1000 - 1000);
    });

    it('marks cacheHit=false on a fresh response', async () => {
      makeMerchantsQb([]);
      const result = await service.getTopMerchants({ limit: 10, period: '30d' });
      expect(result.cacheHit).toBe(false);
    });

    it('marks cacheHit=true on a cached response', async () => {
      cacheService.getOrSet.mockResolvedValueOnce({
        value: {
          data: [],
          period: '30d',
          periodStart: new Date().toISOString(),
          periodEnd: new Date().toISOString(),
          nextCursor: null,
        },
        cacheHit: true,
      });

      const result = await service.getTopMerchants({ limit: 10, period: '30d' });
      expect(result.cacheHit).toBe(true);
    });

    it('handles null country gracefully', async () => {
      makeMerchantsQb([{ ...sampleRows[0], country: null as any }]);
      const result = await service.getTopMerchants({ limit: 10, period: '30d' });
      expect(result.data[0].country).toBeNull();
    });
  });
});
