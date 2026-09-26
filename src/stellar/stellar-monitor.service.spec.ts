/**
 * Unit tests for StellarMonitorService.
 *
 * Covers:
 *  - scanPendingPayments: happy path, no deposit address, failed Horizon fetch,
 *    unmatched memo, payment fails verification, pollEscrowEvents called once per cycle.
 *  - confirmPayment: successful confirmation, double-settlement guard (pessimistic lock).
 *  - expireOldPayments: marks expired payments and dispatches webhooks.
 *
 * Regression for:
 *  - #188 (dead pollEscrowEvents after return)
 *  - #189 (call to nonexistent pollTransferEvents)
 *  - #191 (no double-settlement guard in confirmPayment)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { StellarMonitorService } from './stellar-monitor.service';
import { StellarService } from './stellar.service';
import { SorobanMonitorService } from './soroban-monitor.service';
import { SettlementsService } from '../settlements/settlements.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EmailService } from '../email/email.service';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { NotificationPrefsService } from '../notifications/notification-prefs.service';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
import { QUEUE_NAMES } from '../queues/queue.constants';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const makeMockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const makeMockDataSource = () => ({
  transaction: jest.fn(),
});

const makeMockStellarService = () => ({
  getDepositAddress: jest.fn(),
  getAccountTransactions: jest.fn(),
  verifyPayment: jest.fn(),
  invokeContract: jest.fn(),
});

const makeMockSorobanMonitor = () => ({
  pollEscrowEvents: jest.fn(),
});

const makeMockSettlements = () => ({
  initiateSettlement: jest.fn(),
});

const makeMockWebhooks = () => ({
  dispatch: jest.fn(),
});

const makeMockEmail = () => ({
  queue: jest.fn(),
});

const makeMockAdminAlerts = () => ({
  raise: jest.fn(),
});

const makeMockNotificationPrefs = () => ({
  isEnabled: jest.fn(),
});

const makeMockQueue = () => ({
  add: jest.fn(),
});

const makeMockConfigService = () => ({
  get: jest.fn((key: string, fallback?: unknown) => {
    if (key === 'STELLAR_NETWORK') return 'TESTNET';
    if (key === 'FRONTEND_URL') return 'http://localhost:3000';
    return fallback;
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-uuid-1',
    reference: 'PAY-REF-001',
    merchantId: 'merchant-uuid-1',
    amountUsd: 50,
    amountUsdc: 50,
    amountXlm: null,
    status: PaymentStatus.PENDING,
    stellarMemo: 'MEMO_001',
    expiresAt: new Date(Date.now() + 60_000), // 1 minute from now
    merchant: { id: 'merchant-uuid-1', email: 'merchant@example.com', businessName: 'ACME' } as any,
    metadata: {},
    ...overrides,
  } as Payment;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('StellarMonitorService', () => {
  let service: StellarMonitorService;
  let paymentsRepo: ReturnType<typeof makeMockRepo>;
  let dataSource: ReturnType<typeof makeMockDataSource>;
  let stellar: ReturnType<typeof makeMockStellarService>;
  let sorobanMonitor: ReturnType<typeof makeMockSorobanMonitor>;
  let settlements: ReturnType<typeof makeMockSettlements>;
  let webhooks: ReturnType<typeof makeMockWebhooks>;
  let adminAlerts: ReturnType<typeof makeMockAdminAlerts>;

  beforeEach(async () => {
    paymentsRepo = makeMockRepo();
    dataSource = makeMockDataSource();
    stellar = makeMockStellarService();
    sorobanMonitor = makeMockSorobanMonitor();
    settlements = makeMockSettlements();
    webhooks = makeMockWebhooks();
    adminAlerts = makeMockAdminAlerts();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarMonitorService,
        { provide: getRepositoryToken(Payment), useValue: paymentsRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: StellarService, useValue: stellar },
        { provide: SorobanMonitorService, useValue: sorobanMonitor },
        { provide: SettlementsService, useValue: settlements },
        { provide: WebhooksService, useValue: webhooks },
        { provide: EmailService, useValue: makeMockEmail() },
        { provide: AdminAlertService, useValue: adminAlerts },
        { provide: NotificationPrefsService, useValue: makeMockNotificationPrefs() },
        { provide: ConfigService, useValue: makeMockConfigService() },
        { provide: getQueueToken(QUEUE_NAMES.stellarMonitor), useValue: makeMockQueue() },
      ],
    }).compile();

    service = module.get(StellarMonitorService);
    jest.clearAllMocks();
  });

  // =========================================================================
  // scanPendingPayments
  // =========================================================================

  describe('scanPendingPayments', () => {
    it('returns early and marks ok when no deposit address is configured', async () => {
      stellar.getDepositAddress.mockReturnValue(null);

      await service.scanPendingPayments();

      expect(stellar.getAccountTransactions).not.toHaveBeenCalled();
      expect(service.getLastRunStatus().status).toBe('ok');
    });

    it('marks failure and returns when Horizon fetch throws', async () => {
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockRejectedValue(new Error('Horizon 503'));

      await service.scanPendingPayments();

      expect(service.getLastRunStatus().status).toBe('error');
      expect(service.getLastRunStatus().lastError).toContain('Horizon 503');
      expect(adminAlerts.raise).toHaveBeenCalledWith(
        expect.objectContaining({ dedupeKey: 'stellar-monitor.fetch' }),
      );
    });

    it('skips transactions without a memo', async () => {
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockResolvedValue([{ hash: 'TX1', paging_token: 'p1', memo: null }]);
      sorobanMonitor.pollEscrowEvents.mockResolvedValue(undefined);

      await service.scanPendingPayments();

      expect(paymentsRepo.findOne).not.toHaveBeenCalled();
      expect(service.getLastRunStatus().status).toBe('ok');
    });

    it('skips transactions whose memo does not match any pending payment', async () => {
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockResolvedValue([
        { hash: 'TX1', paging_token: 'p1', memo: 'UNKNOWN_MEMO' },
      ]);
      paymentsRepo.findOne.mockResolvedValue(null);
      sorobanMonitor.pollEscrowEvents.mockResolvedValue(undefined);

      await service.scanPendingPayments();

      expect(stellar.verifyPayment).not.toHaveBeenCalled();
      expect(service.getLastRunStatus().status).toBe('ok');
    });

    it('skips transactions that fail Stellar payment verification', async () => {
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockResolvedValue([
        { hash: 'TX1', paging_token: 'p1', memo: 'MEMO_001' },
      ]);
      paymentsRepo.findOne.mockResolvedValue(makePayment());
      stellar.verifyPayment.mockResolvedValue({ verified: false });
      sorobanMonitor.pollEscrowEvents.mockResolvedValue(undefined);

      await service.scanPendingPayments();

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(service.getLastRunStatus().status).toBe('ok');
    });

    it('calls confirmPayment when a matching verified transaction is found', async () => {
      const payment = makePayment();
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockResolvedValue([
        { hash: 'TX_HASH_1', paging_token: 'p1', memo: 'MEMO_001' },
      ]);
      paymentsRepo.findOne.mockResolvedValue(payment);
      stellar.verifyPayment.mockResolvedValue({
        verified: true,
        amount: 50,
        asset: 'USDC',
        from: 'GCUSTOMER',
      });
      // dataSource.transaction executes its callback
      dataSource.transaction.mockImplementation(async (cb: (m: any) => Promise<void>) => {
        const manager = { findOne: jest.fn().mockResolvedValue(payment), save: jest.fn() };
        await cb(manager);
      });
      stellar.invokeContract.mockResolvedValue(undefined);
      settlements.initiateSettlement.mockResolvedValue(undefined);
      webhooks.dispatch.mockResolvedValue(undefined);
      sorobanMonitor.pollEscrowEvents.mockResolvedValue(undefined);

      await service.scanPendingPayments();

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(service.getLastRunStatus().status).toBe('ok');
    });

    it('raises an admin alert when confirmPayment throws, but continues scanning', async () => {
      const payment = makePayment();
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockResolvedValue([
        { hash: 'TX_HASH_1', paging_token: 'p1', memo: 'MEMO_001' },
      ]);
      paymentsRepo.findOne.mockResolvedValue(payment);
      stellar.verifyPayment.mockResolvedValue({ verified: true, amount: 50, asset: 'USDC', from: undefined });
      dataSource.transaction.mockRejectedValue(new Error('DB timeout'));
      sorobanMonitor.pollEscrowEvents.mockResolvedValue(undefined);

      // expireOldPayments needs a working queryBuilder
      const qbMock = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([]) };
      paymentsRepo.createQueryBuilder.mockReturnValue(qbMock);

      await service.scanPendingPayments();

      expect(adminAlerts.raise).toHaveBeenCalledWith(
        expect.objectContaining({ dedupeKey: `stellar-monitor.confirm:${payment.id}` }),
      );
      expect(service.getLastRunStatus().status).toBe('ok');
    });

    it('calls pollEscrowEvents exactly once per cycle (#188 / #189 regression)', async () => {
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockResolvedValue([]);
      sorobanMonitor.pollEscrowEvents.mockResolvedValue(undefined);

      const qbMock = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([]) };
      paymentsRepo.createQueryBuilder.mockReturnValue(qbMock);

      await service.scanPendingPayments();

      // Must be called exactly once — not zero (dead code bug #188) and not
      // via the nonexistent pollTransferEvents method (#189)
      expect(sorobanMonitor.pollEscrowEvents).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // confirmPayment — double-settlement guard (#191)
  // =========================================================================

  describe('confirmPayment (double-settlement guard)', () => {
    /**
     * Drive confirmPayment indirectly via a single matching scan cycle.
     * The `managerFactory` callback lets each test control what the
     * pessimistic-lock re-fetch returns.
     */
    async function driveConfirm(
      payment: Payment,
      managerFactory: () => { findOne: jest.Mock; save: jest.Mock },
    ) {
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockResolvedValue([
        { hash: 'TX_HASH_CONFIRM', paging_token: 'p1', memo: payment.stellarMemo },
      ]);
      paymentsRepo.findOne.mockResolvedValue(payment);
      stellar.verifyPayment.mockResolvedValue({ verified: true, amount: 50, asset: 'USDC', from: 'GCUSTOMER' });

      dataSource.transaction.mockImplementation(async (cb: (m: any) => Promise<void>) => {
        await cb(managerFactory());
      });
      stellar.invokeContract.mockResolvedValue(undefined);
      settlements.initiateSettlement.mockResolvedValue(undefined);
      webhooks.dispatch.mockResolvedValue(undefined);
      sorobanMonitor.pollEscrowEvents.mockResolvedValue(undefined);

      const qbMock = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([]) };
      paymentsRepo.createQueryBuilder.mockReturnValue(qbMock);

      await service.scanPendingPayments();
    }

    it('invokes contract, saves, webhooks and initiates settlement when payment is still PENDING', async () => {
      const payment = makePayment();
      const manager = { findOne: jest.fn().mockResolvedValue(payment), save: jest.fn() };

      await driveConfirm(payment, () => manager);

      expect(stellar.invokeContract).toHaveBeenCalledWith('confirm', expect.any(Array));
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.CONFIRMED,
          txHash: 'TX_HASH_CONFIRM',
        }),
      );
      expect(webhooks.dispatch).toHaveBeenCalledWith(
        payment.merchantId,
        'payment.confirmed',
        expect.objectContaining({ txHash: 'TX_HASH_CONFIRM' }),
      );
      expect(settlements.initiateSettlement).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.CONFIRMED }),
      );
    });

    it('skips contract call and settlement when pessimistic lock re-fetch returns null (already confirmed by another worker)', async () => {
      const payment = makePayment();
      // findOne returns null → payment already confirmed/consumed by a concurrent worker
      const manager = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() };

      await driveConfirm(payment, () => manager);

      // Contract must NOT be invoked — double-settlement prevented
      expect(stellar.invokeContract).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(settlements.initiateSettlement).not.toHaveBeenCalled();
      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });

    it('sets amountXlm (not amountUsdc) when asset is XLM', async () => {
      const payment = makePayment();
      const confirmedPayment = { ...payment };
      const manager = { findOne: jest.fn().mockResolvedValue(confirmedPayment), save: jest.fn() };

      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockResolvedValue([
        { hash: 'TX_XLM', paging_token: 'p1', memo: payment.stellarMemo },
      ]);
      paymentsRepo.findOne.mockResolvedValue(payment);
      stellar.verifyPayment.mockResolvedValue({ verified: true, amount: 100, asset: 'XLM', from: undefined });
      dataSource.transaction.mockImplementation(async (cb: (m: any) => Promise<void>) => {
        await cb(manager);
      });
      stellar.invokeContract.mockResolvedValue(undefined);
      settlements.initiateSettlement.mockResolvedValue(undefined);
      webhooks.dispatch.mockResolvedValue(undefined);
      sorobanMonitor.pollEscrowEvents.mockResolvedValue(undefined);
      paymentsRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      await service.scanPendingPayments();

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ amountXlm: 100 }),
      );
    });
  });

  // =========================================================================
  // expireOldPayments
  // =========================================================================

  describe('expireOldPayments', () => {
    /**
     * Drive expireOldPayments by running a full scan cycle with no Horizon
     * transactions, but returning expired payments from the query builder.
     */
    async function driveExpiry(expiredPayments: Payment[]) {
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockResolvedValue([]);
      sorobanMonitor.pollEscrowEvents.mockResolvedValue(undefined);

      const qbMock = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(expiredPayments),
      };
      paymentsRepo.createQueryBuilder.mockReturnValue(qbMock);

      await service.scanPendingPayments();
    }

    it('marks expired payments as EXPIRED and dispatches webhooks', async () => {
      const expired = makePayment({ expiresAt: new Date(Date.now() - 60_000) });
      stellar.invokeContract.mockResolvedValue(undefined);
      paymentsRepo.save.mockResolvedValue(expired);
      webhooks.dispatch.mockResolvedValue(undefined);

      await driveExpiry([expired]);

      expect(stellar.invokeContract).toHaveBeenCalledWith('expire', [expired.id]);
      expect(paymentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.EXPIRED }),
      );
      expect(webhooks.dispatch).toHaveBeenCalledWith(
        expired.merchantId,
        'payment.expired',
        expect.objectContaining({ paymentId: expired.id }),
      );
    });

    it('raises an admin alert and continues when a single expiry fails', async () => {
      const expired1 = makePayment({ id: 'p1', stellarMemo: 'MEMO_1', expiresAt: new Date(Date.now() - 60_000) });
      const expired2 = makePayment({ id: 'p2', stellarMemo: 'MEMO_2', expiresAt: new Date(Date.now() - 60_000) });

      stellar.invokeContract
        .mockRejectedValueOnce(new Error('Contract timeout'))  // p1 fails
        .mockResolvedValueOnce(undefined);                      // p2 succeeds
      paymentsRepo.save.mockResolvedValue(expired2);
      webhooks.dispatch.mockResolvedValue(undefined);

      await driveExpiry([expired1, expired2]);

      expect(adminAlerts.raise).toHaveBeenCalledWith(
        expect.objectContaining({ dedupeKey: `stellar-monitor.expire:${expired1.id}` }),
      );
      // p2 must still be expired despite p1 failing
      expect(paymentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p2', status: PaymentStatus.EXPIRED }),
      );
    });

    it('does nothing when there are no expired payments', async () => {
      await driveExpiry([]);

      expect(stellar.invokeContract).not.toHaveBeenCalled();
      expect(paymentsRepo.save).not.toHaveBeenCalled();
      expect(service.getLastRunStatus().status).toBe('ok');
    });
  });

  // =========================================================================
  // getLastRunStatus
  // =========================================================================

  describe('getLastRunStatus', () => {
    it('returns idle status before any scan has run', () => {
      const status = service.getLastRunStatus();
      expect(status.status).toBe('idle');
      expect(status.lastRunAt).toBeNull();
      expect(status.lastError).toBeNull();
    });

    it('returns ok status and a timestamp after a successful scan', async () => {
      stellar.getDepositAddress.mockReturnValue(null);

      await service.scanPendingPayments();

      const status = service.getLastRunStatus();
      expect(status.status).toBe('ok');
      expect(status.lastRunAt).not.toBeNull();
      expect(status.lastError).toBeNull();
    });

    it('returns error status and message after a failed scan', async () => {
      stellar.getDepositAddress.mockReturnValue('GDEP_ADDR');
      stellar.getAccountTransactions.mockRejectedValue(new Error('network error'));

      await service.scanPendingPayments();

      const status = service.getLastRunStatus();
      expect(status.status).toBe('error');
      expect(status.lastError).toContain('network error');
    });

    it('is a synchronous getter that does NOT call pollEscrowEvents (#188 regression)', () => {
      // pollEscrowEvents must never be called as a side-effect of reading status
      service.getLastRunStatus();
      expect(sorobanMonitor.pollEscrowEvents).not.toHaveBeenCalled();
    });
  });
});
