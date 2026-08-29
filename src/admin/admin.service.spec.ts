import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { AdminService } from './admin.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Merchant, MerchantStatus } from '../merchants/entities/merchant.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Settlement } from '../settlements/entities/settlement.entity';
import { FeeConfig, FeeType } from '../fee-config/entities/fee-config.entity';
import { FeeHistory, FeeChangeType } from '../fee-config/entities/fee-history.entity';
import { AuditLog } from './entities/audit-log.entity';
import { FilterService } from '../common/filter.service';
import { CacheService } from '../cache/cache.service';
import { StellarMonitorService } from '../stellar/stellar-monitor.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('AdminService', () => {
  let service: AdminService;
  let merchantsRepo: any;
  let paymentsRepo: any;
  let feeConfigRepo: any;
  let feeHistoryRepo: any;
  let auditLogRepo: any;

  const mockRepository = () => ({
    findAndCount: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: getRepositoryToken(Merchant),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(Payment),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(Settlement),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(FeeConfig),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(FeeHistory),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AuditLog),
          useFactory: mockRepository,
        },
        {
          provide: FilterService,
          useValue: { buildWhereConditions: jest.fn().mockReturnValue({}) },
        },
        {
          provide: CacheService,
          useValue: {
            getOrSet: jest.fn(),
            del: jest.fn(),
            delPattern: jest.fn(),
          },
        },
        {
          provide: StellarMonitorService,
          useValue: { getLastRunStatus: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    merchantsRepo = module.get(getRepositoryToken(Merchant));
    paymentsRepo = module.get(getRepositoryToken(Payment));
    feeConfigRepo = module.get(getRepositoryToken(FeeConfig));
    feeHistoryRepo = module.get(getRepositoryToken(FeeHistory));
    auditLogRepo = module.get(getRepositoryToken(AuditLog));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllMerchants', () => {
    it('should return paginated merchants with default values', async () => {
      const merchants = [{ id: '1', email: 'm1@test.com', passwordHash: 'hash' }];
      merchantsRepo.findAndCount.mockResolvedValue([merchants, 1]);

      const result = await service.findAllMerchants();
      expect(result.merchants).toHaveLength(1);
      expect(merchantsRepo.findAndCount).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        order: { createdAt: 'DESC' },
      });
    });

    it('should return paginated merchants with custom values', async () => {
      const merchants = [{ id: '1', email: 'm1@test.com', passwordHash: 'hash' }];
      merchantsRepo.findAndCount.mockResolvedValue([merchants, 1]);

      const result = await service.findAllMerchants(2, 10);
      expect(result.merchants).toHaveLength(1);
      expect(merchantsRepo.findAndCount).toHaveBeenCalledWith({
        skip: 10,
        take: 10,
        order: { createdAt: 'DESC' },
      });
    });
  });

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

  describe('updateMerchantStatus', () => {
    it('should update and return merchant status', async () => {
      const merchant = { id: '1', status: MerchantStatus.PENDING };
      merchantsRepo.findOne.mockResolvedValue(merchant);
      merchantsRepo.save.mockResolvedValue({ ...merchant, status: MerchantStatus.ACTIVE });

      const result = await service.updateMerchantStatus('1', MerchantStatus.ACTIVE);
      expect(result.status).toBe(MerchantStatus.ACTIVE);
      expect(merchantsRepo.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if merchant not found', async () => {
      merchantsRepo.findOne.mockResolvedValue(null);
      await expect(service.updateMerchantStatus('1', MerchantStatus.ACTIVE)).rejects.toThrow(NotFoundException);
    });
  });

  describe('bulkUpdateMerchantStatus', () => {
    it('should handle partial failures', async () => {
      const ids = ['1', '2'];
      merchantsRepo.findOne
        .mockResolvedValueOnce({ id: '1', status: MerchantStatus.PENDING })
        .mockResolvedValueOnce(null);

      const result = await service.bulkUpdateMerchantStatus(ids, MerchantStatus.ACTIVE);

      expect(result.success).toContain('1');
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe('2');
      expect(result.failed[0].error).toBe('Merchant not found');
    });

    it('should succeed for all when all exist', async () => {
      const ids = ['1', '2'];
      merchantsRepo.findOne.mockResolvedValue({ id: 'any', status: MerchantStatus.PENDING });

      const result = await service.bulkUpdateMerchantStatus(ids, MerchantStatus.ACTIVE);
      expect(result.success).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('getGlobalStats', () => {
    it('should return aggregated stats', async () => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(),
      };

      paymentsRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      merchantsRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      mockQueryBuilder.getRawMany
        .mockResolvedValueOnce([{ status: 'completed', count: '5', totalUsd: '500' }])
        .mockResolvedValueOnce([{ status: 'active', count: '2' }]);

      const result = await service.getGlobalStats();
      expect(result.payments).toHaveLength(1);
      expect(result.merchants).toHaveLength(1);
      expect(result.payments[0].status).toBe('completed');
      expect(result.merchants[0].status).toBe('active');
    });
  });

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

      const result = await service.updateGlobalFee(
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

  // ── #214: hand-rolled RFC 6238 TOTP (admin 2FA) ───────────────────────────
  describe('TOTP (admin 2FA)', () => {
    // RFC 6238 Appendix B reference seed: ASCII "12345678901234567890".
    const RFC_SEED = '12345678901234567890';
    const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const call = (name: string, ...args: any[]) => (service as any)[name](...args);

    afterEach(() => jest.restoreAllMocks());

    describe('base32 codec', () => {
      it('encodes the RFC 6238 seed to its canonical base32 form', () => {
        expect(call('base32Encode', Buffer.from(RFC_SEED))).toBe(RFC_SECRET_B32);
      });

      it('round-trips random buffers of every length modulo 5 bits', () => {
        for (const len of [1, 2, 3, 4, 5, 7, 10, 16, 20, 31]) {
          const buf = crypto.randomBytes(len);
          const encoded = call('base32Encode', buf);
          expect(encoded).toMatch(/^[A-Z2-7]+$/);
          expect(call('base32Decode', encoded).equals(buf)).toBe(true);
        }
      });

      it('decodes case-insensitively and tolerates "=" padding and stray separators', () => {
        const buf = Buffer.from('1234567890');
        const canonical = call('base32Encode', buf); // GEZDGNBVGY3TQOJQ
        expect(call('base32Decode', canonical.toLowerCase()).equals(buf)).toBe(true);
        expect(call('base32Decode', canonical + '======').equals(buf)).toBe(true);
        expect(
          call('base32Decode', canonical.replace(/(.{4})/g, '$1 ').trim()).equals(buf),
        ).toBe(true);
      });
    });

    describe('totpCode — RFC 6238 Appendix B known-answer vectors', () => {
      const vectors: Array<[number, string]> = [
        [59, '287082'],
        [1111111109, '081804'],
        [1111111111, '050471'],
        [1234567890, '005924'],
        [2000000000, '279037'],
        [20000000000, '353130'],
      ];

      it.each(vectors)('t=%d seconds -> %s', (time, expected) => {
        expect(call('totpCode', RFC_SECRET_B32, time)).toBe(expected);
      });

      it('always returns a zero-padded 6-digit string', () => {
        for (let t = 0; t < 30 * 40; t += 7) {
          expect(call('totpCode', RFC_SECRET_B32, t)).toMatch(/^\d{6}$/);
        }
      });

      it('is stable within a 30s step and rolls over at the boundary', () => {
        expect(call('totpCode', RFC_SECRET_B32, 0)).toBe(call('totpCode', RFC_SECRET_B32, 29));
        expect(call('totpCode', RFC_SECRET_B32, 0)).not.toBe(call('totpCode', RFC_SECRET_B32, 30));
      });
    });

    describe('verifyTotpToken — clock-drift window', () => {
      const nowSec = 1_700_000_037; // arbitrary point mid-step
      const at = (s: number) => jest.spyOn(Date, 'now').mockReturnValue(s * 1000);

      it('accepts the current step and ±1 step of drift', () => {
        const code = call('totpCode', RFC_SECRET_B32, nowSec);
        for (const skew of [-30, 0, 30]) {
          at(nowSec + skew);
          expect(call('verifyTotpToken', RFC_SECRET_B32, code)).toBe(true);
        }
      });

      it('rejects a token that is more than one step stale or ahead', () => {
        const code = call('totpCode', RFC_SECRET_B32, nowSec);
        for (const skew of [-60, 60, 300]) {
          at(nowSec + skew);
          expect(call('verifyTotpToken', RFC_SECRET_B32, code)).toBe(false);
        }
      });

      it('rejects malformed, empty and wrong-length tokens', () => {
        at(nowSec);
        // A numeric code guaranteed not to match any of the 3 accepted windows.
        const accepted = new Set(
          [-30, 0, 30].map((s) => call('totpCode', RFC_SECRET_B32, nowSec + s)),
        );
        let n = 0;
        while (accepted.has(String(n).padStart(6, '0'))) n++;
        const wrongCode = String(n).padStart(6, '0');

        for (const bad of ['', 'abcdef', '12345', '1234567', wrongCode]) {
          expect(call('verifyTotpToken', RFC_SECRET_B32, bad)).toBe(false);
        }
      });
    });

    describe('setupAdminTotp / verifyAdminTotp', () => {
      it('setupAdminTotp persists a fresh 32-char base32 secret and returns an otpauth URI', async () => {
        const merchant: any = { id: 'a1', email: 'admin@dupdub.test', totpSecret: null };
        merchantsRepo.findOne.mockResolvedValue(merchant);
        merchantsRepo.save.mockImplementation(async (m: any) => m);

        const { secret, otpauthUri } = await service.setupAdminTotp('a1');

        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(merchant.totpSecret).toBe(secret);
        expect(otpauthUri).toBe(
          `otpauth://totp/DupDub:admin@dupdub.test?secret=${secret}&issuer=DupDub`,
        );
        expect(merchantsRepo.save).toHaveBeenCalledWith(merchant);
      });

      it('setupAdminTotp throws NotFoundException for an unknown user', async () => {
        merchantsRepo.findOne.mockResolvedValue(null);
        await expect(service.setupAdminTotp('nope')).rejects.toThrow(NotFoundException);
      });

      it('verifyAdminTotp enables 2FA and persists on a valid token', async () => {
        const nowSec = 1_700_000_037;
        jest.spyOn(Date, 'now').mockReturnValue(nowSec * 1000);
        const merchant: any = { id: 'a1', totpSecret: RFC_SECRET_B32, totpEnabled: false };
        merchantsRepo.findOne.mockResolvedValue(merchant);
        merchantsRepo.save.mockImplementation(async (m: any) => m);

        const res = await service.verifyAdminTotp(
          'a1',
          call('totpCode', RFC_SECRET_B32, nowSec),
        );

        expect(res).toEqual({ success: true });
        expect(merchant.totpEnabled).toBe(true);
        expect(merchantsRepo.save).toHaveBeenCalledWith(merchant);
      });

      it('verifyAdminTotp rejects an invalid token without enabling 2FA', async () => {
        const nowSec = 1_700_000_037;
        jest.spyOn(Date, 'now').mockReturnValue(nowSec * 1000);
        const merchant: any = { id: 'a1', totpSecret: RFC_SECRET_B32, totpEnabled: false };
        merchantsRepo.findOne.mockResolvedValue(merchant);

        const accepted = new Set(
          [-30, 0, 30].map((s) => call('totpCode', RFC_SECRET_B32, nowSec + s)),
        );
        let n = 0;
        while (accepted.has(String(n).padStart(6, '0'))) n++;

        const res = await service.verifyAdminTotp('a1', String(n).padStart(6, '0'));

        expect(res).toEqual({ success: false });
        expect(merchant.totpEnabled).toBe(false);
        expect(merchantsRepo.save).not.toHaveBeenCalled();
      });

      it('verifyAdminTotp throws BadRequestException when TOTP was never set up', async () => {
        merchantsRepo.findOne.mockResolvedValue({ id: 'a1', totpSecret: null });
        await expect(service.verifyAdminTotp('a1', '123456')).rejects.toThrow(
          BadRequestException,
        );
      });
    });
  });

  // ── #215: CSV / formula injection in audit-log export ─────────────────────
  describe('audit-log CSV export (toCsv)', () => {
    const toCsv = (rows: any[]) => (service as any).toCsv(rows);

    it('returns a quoted header row when there is no data', () => {
      expect(toCsv([])).toBe(
        '"id","actor","action","resourceType","resourceId","details","createdAt"\n',
      );
    });

    it('quotes fields and escapes embedded commas, quotes and newlines', () => {
      const line = toCsv([
        {
          id: '1',
          actor: 'ada, admin',
          action: 'say "hi"',
          resourceType: 'a\nb',
          resourceId: 'r1',
          details: { note: 'x,y' },
          createdAt: '2026-08-29',
        },
      ]).split('\r\n')[1];

      expect(line).toBe(
        '"1","ada, admin","say ""hi""","a\nb","r1","{""note"":""x,y""}","2026-08-29"',
      );
    });

    it('neutralises formula-injection payloads with a leading apostrophe', () => {
      const row = toCsv([
        {
          id: '1',
          actor: '=1+1',
          action: '+SUM(A1:A9)',
          resourceType: '-2+3',
          resourceId: '@cmd',
          details: '=HYPERLINK("http://evil","x")',
          createdAt: 'ok',
        },
      ]).split('\r\n')[1];

      expect(row).toContain('"\'=1+1"');
      expect(row).toContain('"\'+SUM(A1:A9)"');
      expect(row).toContain('"\'-2+3"');
      expect(row).toContain('"\'@cmd"');
      expect(row).toContain('"\'=HYPERLINK(""http://evil"",""x"")"');
      expect(row.startsWith('"1","\'=1+1"')).toBe(true);
    });

    it('renders null/undefined as empty quoted fields', () => {
      const row = toCsv([
        {
          id: '1',
          actor: null,
          action: undefined,
          resourceType: 'x',
          resourceId: 'y',
          details: null,
          createdAt: 'z',
        },
      ]).split('\r\n')[1];
      expect(row).toBe('"1","","","x","y","","z"');
    });
  });
});
