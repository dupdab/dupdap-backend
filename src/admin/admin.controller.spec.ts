import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { RatesService } from '../rates/rates.service';
import { MerchantStatus, MerchantRole } from '../merchants/entities/merchant.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { IpAllowlistGuard } from '../security/ip-allowlist.guard';
import { Reflector } from '@nestjs/core';

describe('AdminController', () => {
  let controller: AdminController;
  let service: AdminService;

  const mockAdminService = {
    findAllMerchants: jest.fn(),
    findOneMerchant: jest.fn(),
    updateMerchantStatus: jest.fn(),
    bulkUpdateMerchantStatus: jest.fn(),
    getGlobalStats: jest.fn(),
    getLiveAnalytics: jest.fn(),
    getGlobalFees: jest.fn(),
    updateGlobalFee: jest.fn(),
    flushCache: jest.fn(),
    getGeographicDistribution: jest.fn(),
    createAdmin: jest.fn(),
    deleteAdmin: jest.fn(),
    setupAdminTotp: jest.fn(),
    verifyAdminTotp: jest.fn(),
    updateAdminAllowedIps: jest.fn(),
    toggleSandboxMode: jest.fn(),
    resetSandboxData: jest.fn(),
    getAuditLogs: jest.fn(),
    getAdminPayments: jest.fn(),
    getAdminPaymentById: jest.fn(),
    restoreRecord: jest.fn(),
    deleteRecord: jest.fn(),
    getAccessControlReport: jest.fn(),
    getFailedAuthReport: jest.fn(),
    getDataRetentionReport: jest.fn(),
    getSettlementReconciliationReport: jest.fn(),
    getFullComplianceReport: jest.fn(),
  };

  const mockRatesService = {
    fetchAndCache: jest.fn(),
  };

  const mockRes = () => {
    const res: any = {};
    res.setHeader = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.write = jest.fn().mockReturnValue(res);
    res.end = jest.fn().mockReturnValue(res);
    res.on = jest.fn().mockReturnValue(res);
    res.once = jest.fn().mockReturnValue(res);
    res.emit = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: RatesService, useValue: mockRatesService },
        Reflector,
      ],
    })
      .overrideGuard(IpAllowlistGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminController>(AdminController);
    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── Merchant management ────────────────────────────────────────────────────

  describe('findAllMerchants', () => {
    it('should call service.findAllMerchants with default values', async () => {
      const result = { merchants: [], total: 0 };
      mockAdminService.findAllMerchants.mockResolvedValue(result);
      expect(await controller.findAllMerchants()).toBe(result);
      expect(service.findAllMerchants).toHaveBeenCalledWith(1, 20);
    });

    it('should call service.findAllMerchants with custom values', async () => {
      const result = { merchants: [], total: 0 };
      mockAdminService.findAllMerchants.mockResolvedValue(result);
      expect(await controller.findAllMerchants(2, 50)).toBe(result);
      expect(service.findAllMerchants).toHaveBeenCalledWith(2, 50);
    });
  });

  describe('findOneMerchant', () => {
    it('should call service.findOneMerchant', async () => {
      const result = { id: '1', email: 'test@test.com' };
      mockAdminService.findOneMerchant.mockResolvedValue(result);
      expect(await controller.findOneMerchant('1')).toBe(result);
      expect(service.findOneMerchant).toHaveBeenCalledWith('1');
    });
  });

  describe('updateStatus', () => {
    it('should call service.updateMerchantStatus', async () => {
      const result = { id: '1', status: MerchantStatus.ACTIVE };
      mockAdminService.updateMerchantStatus.mockResolvedValue(result);
      expect(await controller.updateStatus('1', MerchantStatus.ACTIVE)).toBe(result);
      expect(service.updateMerchantStatus).toHaveBeenCalledWith('1', MerchantStatus.ACTIVE);
    });
  });

  describe('bulkUpdateStatus', () => {
    it('should call service.bulkUpdateMerchantStatus', async () => {
      const result = { success: ['1'], failed: [] };
      mockAdminService.bulkUpdateMerchantStatus.mockResolvedValue(result);
      expect(await controller.bulkUpdateStatus(['1'], MerchantStatus.ACTIVE)).toBe(result);
      expect(service.bulkUpdateMerchantStatus).toHaveBeenCalledWith(['1'], MerchantStatus.ACTIVE);
    });
  });

  describe('getStats', () => {
    it('should call service.getGlobalStats', async () => {
      const result = { payments: [], merchants: [] };
      mockAdminService.getGlobalStats.mockResolvedValue(result);
      expect(await controller.getStats()).toBe(result);
      expect(service.getGlobalStats).toHaveBeenCalled();
    });
  });

  describe('getLiveAnalytics', () => {
    it('should call service.getLiveAnalytics', async () => {
      const result = { cacheHit: false };
      mockAdminService.getLiveAnalytics.mockResolvedValue(result);
      expect(await controller.getLiveAnalytics()).toBe(result);
      expect(service.getLiveAnalytics).toHaveBeenCalled();
    });
  });

  // ── Fee configuration ─────────────────────────────────────────────────────

  describe('getFees', () => {
    it('should call service.getGlobalFees', async () => {
      const result = [{ feeType: 'payment', rate: '0.01' }];
      mockAdminService.getGlobalFees.mockResolvedValue(result);
      expect(await controller.getFees()).toBe(result);
      expect(service.getGlobalFees).toHaveBeenCalled();
    });
  });

  describe('updateFee', () => {
    it('should forward fee type, rate, actor id and reason to the service', async () => {
      const result = { feeType: 'payment', rate: '0.02' };
      mockAdminService.updateGlobalFee.mockResolvedValue(result);
      const req: any = { user: { id: 'admin-1' } };

      expect(
        await controller.updateFee(
          { feeType: 'payment', newRate: '0.02', reason: 'promo' },
          req,
        ),
      ).toBe(result);
      expect(service.updateGlobalFee).toHaveBeenCalledWith(
        'payment',
        '0.02',
        'admin-1',
        'promo',
      );
    });
  });

  // ── Cache management ──────────────────────────────────────────────────────

  describe('refreshRateCache', () => {
    it('should refresh the XLM/USD rate cache and return the new rate', async () => {
      mockRatesService.fetchAndCache.mockResolvedValue(0.115);
      expect(await controller.refreshRateCache()).toEqual({ rate: 0.115 });
      expect(mockRatesService.fetchAndCache).toHaveBeenCalled();
    });
  });

  describe('flushCache', () => {
    it('should call service.flushCache', async () => {
      const result = { flushed: ['analytics', 'rates', 'fees'] };
      mockAdminService.flushCache.mockResolvedValue(result);
      expect(await controller.flushCache()).toBe(result);
      expect(service.flushCache).toHaveBeenCalled();
    });
  });

  // ── Analytics ────────────────────────────────────────────────────────────

  describe('getGeographicDistribution', () => {
    it('should default to sorting by volume', async () => {
      const result = { countries: [] };
      mockAdminService.getGeographicDistribution.mockResolvedValue(result);
      expect(await controller.getGeographicDistribution()).toBe(result);
      expect(service.getGeographicDistribution).toHaveBeenCalledWith('volume');
    });

    it('should pass through a custom sortBy', async () => {
      mockAdminService.getGeographicDistribution.mockResolvedValue({});
      await controller.getGeographicDistribution('count');
      expect(service.getGeographicDistribution).toHaveBeenCalledWith('count');
    });
  });

  // ── Admin user management (security-sensitive) ────────────────────────────

  describe('createAdmin', () => {
    it('should pass the caller role through to the service', async () => {
      const result = { id: 'new-admin' };
      mockAdminService.createAdmin.mockResolvedValue(result);
      const req: any = { user: { id: 'admin-1', role: MerchantRole.SUPERADMIN } };

      expect(
        await controller.createAdmin(
          { email: 'a@b.com', password: 'StrongPass1!', businessName: 'Ops' },
          req,
        ),
      ).toBe(result);
      expect(service.createAdmin).toHaveBeenCalledWith(
        'a@b.com',
        'StrongPass1!',
        'Ops',
        MerchantRole.SUPERADMIN,
      );
    });
  });

  describe('deleteAdmin', () => {
    it('should forward the target id and caller role', async () => {
      mockAdminService.deleteAdmin.mockResolvedValue({ deleted: true });
      const req: any = { user: { id: 'admin-1', role: MerchantRole.SUPERADMIN } };

      expect(await controller.deleteAdmin('target-id', req)).toEqual({ deleted: true });
      expect(service.deleteAdmin).toHaveBeenCalledWith('target-id', MerchantRole.SUPERADMIN);
    });
  });

  describe('setupAdminTotp', () => {
    it('should call service.setupAdminTotp with the admin id', async () => {
      const result = { secret: 'BASE32', otpauthUrl: 'otpauth://...' };
      mockAdminService.setupAdminTotp.mockResolvedValue(result);
      expect(await controller.setupAdminTotp('admin-1')).toBe(result);
      expect(service.setupAdminTotp).toHaveBeenCalledWith('admin-1');
    });
  });

  describe('verifyAdminTotp', () => {
    it('should forward the admin id and TOTP token', async () => {
      mockAdminService.verifyAdminTotp.mockResolvedValue({ enabled: true });
      expect(await controller.verifyAdminTotp('admin-1', '123456')).toEqual({ enabled: true });
      expect(service.verifyAdminTotp).toHaveBeenCalledWith('admin-1', '123456');
    });
  });

  describe('updateAdminAllowedIps', () => {
    it('should forward the admin id and the new IP allowlist', async () => {
      const ips = ['10.0.0.1', '10.0.0.2'];
      mockAdminService.updateAdminAllowedIps.mockResolvedValue({ allowedIps: ips });
      expect(await controller.updateAdminAllowedIps('admin-1', ips)).toEqual({ allowedIps: ips });
      expect(service.updateAdminAllowedIps).toHaveBeenCalledWith('admin-1', ips);
    });
  });

  // ── Sandbox environment management ────────────────────────────────────────

  describe('toggleSandboxMode', () => {
    it('should forward the merchant id and enabled flag', async () => {
      mockAdminService.toggleSandboxMode.mockResolvedValue({ sandbox: true });
      expect(await controller.toggleSandboxMode('merchant-1', true)).toEqual({ sandbox: true });
      expect(service.toggleSandboxMode).toHaveBeenCalledWith('merchant-1', true);
    });
  });

  describe('resetSandboxData', () => {
    it('should call service.resetSandboxData with the merchant id', async () => {
      mockAdminService.resetSandboxData.mockResolvedValue({ deleted: 12 });
      expect(await controller.resetSandboxData('merchant-1')).toEqual({ deleted: 12 });
      expect(service.resetSandboxData).toHaveBeenCalledWith('merchant-1');
    });
  });

  // ── Audit log viewer ─────────────────────────────────────────────────────

  describe('getAuditLogs', () => {
    it('should respond with JSON when no export is requested', async () => {
      const result = { data: [], total: 0 };
      mockAdminService.getAuditLogs.mockResolvedValue(result);
      const res = mockRes();

      await controller.getAuditLogs({}, {} as any, res, undefined, undefined);

      expect(service.getAuditLogs).toHaveBeenCalledWith({}, {}, false);
      expect(res.json).toHaveBeenCalledWith(result);
      expect(res.send).not.toHaveBeenCalled();
    });

    it('should stream CSV when export=csv', async () => {
      mockAdminService.getAuditLogs.mockResolvedValue('id,action\n1,LOGIN');
      const res = mockRes();

      await controller.getAuditLogs({}, {} as any, res, 'csv', undefined);

      expect(service.getAuditLogs).toHaveBeenCalledWith({}, {}, true);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="audit-log.csv"',
      );
      expect(res.send).toHaveBeenCalledWith('id,action\n1,LOGIN');
    });

    it('should also treat an Accept: text/csv header as a CSV export request', async () => {
      mockAdminService.getAuditLogs.mockResolvedValue('id,action');
      const res = mockRes();

      await controller.getAuditLogs({}, {} as any, res, undefined, 'text/csv');

      expect(service.getAuditLogs).toHaveBeenCalledWith({}, {}, true);
      expect(res.send).toHaveBeenCalled();
    });
  });

  // ── Platform-wide payment oversight ──────────────────────────────────────

  describe('getAdminPayments', () => {
    it('should apply defaults for page and limit', async () => {
      const result = { data: [], total: 0 };
      mockAdminService.getAdminPayments.mockResolvedValue(result);

      expect(await controller.getAdminPayments({} as any)).toBe(result);
      expect(service.getAdminPayments).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, limit: 20 }),
      );
    });

    it('should forward all supplied filters', async () => {
      mockAdminService.getAdminPayments.mockResolvedValue({ data: [], total: 0 });
      const query: any = {
        page: 3,
        limit: 50,
        merchantId: 'm-1',
        status: 'confirmed',
        network: 'stellar',
        dateFrom: '2026-01-01',
        dateTo: '2026-02-01',
        minAmount: 10,
      };

      await controller.getAdminPayments(query);

      expect(service.getAdminPayments).toHaveBeenCalledWith({
        page: 3,
        limit: 50,
        merchantId: 'm-1',
        status: 'confirmed',
        network: 'stellar',
        dateFrom: '2026-01-01',
        dateTo: '2026-02-01',
        minAmount: 10,
      });
    });
  });

  describe('getAdminPaymentById', () => {
    it('should call service.getAdminPaymentById with the id', async () => {
      const result = { id: 'pay-1' };
      mockAdminService.getAdminPaymentById.mockResolvedValue(result);
      expect(await controller.getAdminPaymentById('pay-1')).toBe(result);
      expect(service.getAdminPaymentById).toHaveBeenCalledWith('pay-1');
    });
  });

  // ── Generic soft/hard delete and restore (destructive) ───────────────────

  describe('restoreRecord', () => {
    it('should forward the entity name and id', async () => {
      mockAdminService.restoreRecord.mockResolvedValue({ restored: true });
      expect(await controller.restoreRecord('payment', 'rec-1')).toEqual({ restored: true });
      expect(service.restoreRecord).toHaveBeenCalledWith('payment', 'rec-1');
    });
  });

  describe('deleteRecord', () => {
    it('should perform a soft delete by default', async () => {
      mockAdminService.deleteRecord.mockResolvedValue({ softDeleted: true });
      const req: any = { user: { id: 'admin-1', role: MerchantRole.ADMIN } };

      await controller.deleteRecord('payment', 'rec-1', 'false', req);

      expect(service.deleteRecord).toHaveBeenCalledWith(
        'payment',
        'rec-1',
        false,
        MerchantRole.ADMIN,
      );
    });

    it('should perform a hard delete when hard=true and pass the caller role', async () => {
      mockAdminService.deleteRecord.mockResolvedValue({ hardDeleted: true });
      const req: any = { user: { id: 'admin-1', role: MerchantRole.SUPERADMIN } };

      await controller.deleteRecord('payment', 'rec-1', 'true', req);

      expect(service.deleteRecord).toHaveBeenCalledWith(
        'payment',
        'rec-1',
        true,
        MerchantRole.SUPERADMIN,
      );
    });
  });

  // ── PCI-DSS compliance reports ───────────────────────────────────────────

  describe('getComplianceReport', () => {
    it('should return the full report as JSON by default', async () => {
      const data = { section: 'full' };
      mockAdminService.getFullComplianceReport.mockResolvedValue(data);
      const res = mockRes();

      await controller.getComplianceReport('2026-01-01', '2026-02-01', 'full', 'json', res);

      expect(mockAdminService.getFullComplianceReport).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ status: 'success', data });
    });

    it.each([
      ['access-control', 'getAccessControlReport'],
      ['failed-auth', 'getFailedAuthReport'],
      ['data-retention', 'getDataRetentionReport'],
      ['settlements', 'getSettlementReconciliationReport'],
    ])('should route type "%s" to service.%s', async (type, method) => {
      (mockAdminService as any)[method].mockResolvedValue({ type });
      const res = mockRes();

      await controller.getComplianceReport('2026-01-01', '2026-02-01', type, 'json', res);

      expect((mockAdminService as any)[method]).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ status: 'success', data: { type } });
    });

    it('should generate a PDF attachment when format=pdf', async () => {
      mockAdminService.getFullComplianceReport.mockResolvedValue({ ok: true });
      const res = mockRes();

      await controller.getComplianceReport('2026-01-01', '2026-02-01', 'full', 'pdf', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('compliance-report-full-'),
      );
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should fall back to a default 30-day window when no dates are given', async () => {
      mockAdminService.getFullComplianceReport.mockResolvedValue({});
      const res = mockRes();

      await controller.getComplianceReport(
        undefined as any,
        undefined as any,
        'full',
        'json',
        res,
      );

      const [fromDate, toDate] = mockAdminService.getFullComplianceReport.mock.calls[0];
      expect(fromDate).toBeInstanceOf(Date);
      expect(toDate).toBeInstanceOf(Date);
      expect(toDate.getTime()).toBeGreaterThan(fromDate.getTime());
    });
  });
});
