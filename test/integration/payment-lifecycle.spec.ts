import { MerchantMember, MemberRole } from '../../src/merchants/entities/merchant-member.entity';
import { TeamService } from '../../src/merchants/team.service';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { PaymentsService } from '../../src/payments/payments.service';
import { SettlementsService } from '../../src/settlements/settlements.service';
import { StellarMonitorService } from '../../src/stellar/stellar-monitor.service';
import { WebhooksService } from '../../src/webhooks/webhooks.service';
import { Merchant } from '../../src/merchants/entities/merchant.entity';
import { Payment, PaymentStatus } from '../../src/payments/entities/payment.entity';
import { PaymentEvent } from '../../src/payments/entities/payment-event.entity';
import { Settlement, SettlementStatus } from '../../src/settlements/entities/settlement.entity';
import { Webhook } from '../../src/webhooks/entities/webhook.entity';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  actual.post = jest.fn();
  return actual;
});

describe('Payment lifecycle (real PostgreSQL repositories and transactions)', () => {
  let db: DataSource;
  let payments: PaymentsService, settlements: SettlementsService, monitor: StellarMonitorService;
  let merchant: Merchant, stellar: any, rpc: any, delivery: any, alerts: any, queue: any;
  const schema = `integration_${randomUUID().replace(/-/g, '')}`;
  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', url: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:integration@localhost:55432/dupdap_integration',
      schema, entities: [Merchant, Payment, PaymentEvent, Settlement, Webhook, MerchantMember], synchronize: false,
      entitySkipConstructor: true });
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.synchronize();
  });
  afterAll(async () => {
    if (db?.isInitialized) { await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.destroy(); }
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await db.getRepository(PaymentEvent).createQueryBuilder().delete().execute();
    await db.getRepository(Payment).createQueryBuilder().delete().execute();
    await db.getRepository(Settlement).createQueryBuilder().delete().execute();
    await db.getRepository(Webhook).createQueryBuilder().delete().execute();
    await db.getRepository(MerchantMember).createQueryBuilder().delete().execute();
    await db.getRepository(Merchant).createQueryBuilder().delete().execute();
    merchant = await db.getRepository(Merchant).save({ email: 'owner@example.com', passwordHash: 'test', businessName: 'Test' });
    // Empty secret bypasses encryption; only enqueue boundary is mocked.
    await db.getRepository(Webhook).save({ merchantId: merchant.id, url: 'https://example.com/hook', secret: '', events: ['*'], isActive: true });
    stellar = { getXlmUsdRate: jest.fn().mockResolvedValue({ rate: 0.1, isFallback: false }),
      generateMemo: jest.fn().mockReturnValue('TESTMEMO'), getDepositAddress: () => 'GTEST',
      getAccountTransactions: jest.fn().mockResolvedValue([{ hash: 'tx-1', memo: 'TESTMEMO', paging_token: '1' }]),
      verifyPayment: jest.fn().mockResolvedValue({ verified: true, amount: 1000, asset: 'XLM', from: 'GCUSTOMER' }),
      invokeContract: jest.fn().mockResolvedValue('rpc-tx') };
    rpc = { createPayment: jest.fn().mockReturnValue({ expiryLedger: 360 }), confirm: jest.fn() };
    delivery = { enqueueDelivery: jest.fn().mockResolvedValue(undefined) };
    const webhooks = new WebhooksService(db.getRepository(Webhook), delivery);
    const analytics = { clearCacheForMerchant: jest.fn() };
    const merchants = { findOne: jest.fn().mockResolvedValue({ ...merchant, country: 'US' }) };
    alerts = { raise: jest.fn() }; queue = { add: jest.fn() };
    const retry = { settlement: { maxAttempts: 2, delaysMs: [1] } };
    settlements = new SettlementsService(db.getRepository(Settlement), db.getRepository(Payment),
      { get: (key: string) => key === 'SETTLEMENT_PARTNER_URL' ? 'https://partner.test' : 'test-key' } as any,
      webhooks, alerts, analytics as any, {} as any, merchants as any, {} as any, stellar, queue, {} as any, retry as any);
    payments = new PaymentsService(db.getRepository(Payment), db.getRepository(PaymentEvent), stellar, webhooks,
      {} as any, merchants as any, rpc, analytics as any, db);
    monitor = new StellarMonitorService(db.getRepository(Payment), db, alerts, stellar, settlements, webhooks,
      {} as any, {} as any, { isEnabled: async () => false } as any,
      { pollEscrowEvents: jest.fn() } as any, queue, {} as any);
    (axios.post as jest.Mock).mockResolvedValue({ data: { reference: 'partner-tx' } });
  });
  const create = () => payments.create(merchant.id, { amountUsd: 100 });
  const state = (id: string) => db.getRepository(Payment).findOneByOrFail({ id });
  it('creates → confirms via Horizon/RPC → settles → enqueues matching webhooks; duplicate scan is harmless', async () => {
    const payment = await create();
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(rpc.createPayment).toHaveBeenCalled();
    await monitor.scanPendingPayments();
    const confirmed = await state(payment.id);
    expect(confirmed.status).toBe(PaymentStatus.SETTLING);
    expect(stellar.invokeContract).toHaveBeenCalledWith('confirm', expect.any(Array));
    const settlement = await db.getRepository(Settlement).findOneByOrFail({ id: confirmed.settlementId });
    expect(Number(settlement.netAmountUsd)).toBe(98.5);
    await settlements.processSettlement(settlement.id);
    expect((await db.getRepository(Settlement).findOneByOrFail({ id: settlement.id })).status).toBe(SettlementStatus.COMPLETED);
    expect((await state(payment.id)).status).toBe(PaymentStatus.SETTLED);
    expect(delivery.enqueueDelivery.mock.calls.map((call: any[]) => call[1])).toEqual(['payment.confirmed', 'payment.settling', 'settlement.completed']);
    await monitor.scanPendingPayments();
    expect(await db.getRepository(Settlement).count()).toBe(1);
  });
  it('rejects unavailable live rate before persisting payment', async () => {
    stellar.getXlmUsdRate.mockResolvedValue({ rate: 0.1, isFallback: true });
    await expect(create()).rejects.toThrow('live XLM/USD');
    expect(await db.getRepository(Payment).count()).toBe(0);
  });
  it('leaves pending payments unchanged and alerts on Horizon outage', async () => {
    const payment = await create(); stellar.getAccountTransactions.mockRejectedValue(new Error('Horizon unavailable'));
    await monitor.scanPendingPayments();
    expect((await state(payment.id)).status).toBe(PaymentStatus.PENDING);
    expect(alerts.raise).toHaveBeenCalled();
  });
  it('ignores unverified transactions', async () => {
    const payment = await create(); stellar.verifyPayment.mockResolvedValue({ verified: false });
    await monitor.scanPendingPayments();
    expect((await state(payment.id)).status).toBe(PaymentStatus.PENDING);
    expect(await db.getRepository(Settlement).count()).toBe(0);
  });
  it('rolls back confirmation on Soroban RPC failure', async () => {
    const payment = await create(); stellar.invokeContract.mockRejectedValue(new Error('RPC unavailable'));
    await monitor.scanPendingPayments();
    expect((await state(payment.id)).status).toBe(PaymentStatus.PENDING);
    expect(await db.getRepository(Settlement).count()).toBe(0);
    expect(alerts.raise).toHaveBeenCalled();
  });
  it('expires unpaid payments and dispatches expiration webhook', async () => {
    const payment = await create(); stellar.getAccountTransactions.mockResolvedValue([]);
    await db.getRepository(Payment).update(payment.id, { expiresAt: new Date(0) });
    await monitor.scanPendingPayments();
    expect((await state(payment.id)).status).toBe(PaymentStatus.EXPIRED);
    expect(delivery.enqueueDelivery).toHaveBeenCalledWith(expect.anything(), 'payment.expired', expect.any(String));
  });
  it('persists transfer failure and alerts without a completion webhook', async () => {
    const payment = await create(); await monitor.scanPendingPayments();
    (axios.post as jest.Mock).mockRejectedValue(new Error('Partner unavailable'));
    const id = (await state(payment.id)).settlementId;
    await expect(settlements.processSettlement(id)).rejects.toThrow('Partner unavailable');
    expect((await db.getRepository(Settlement).findOneByOrFail({ id })).status).toBe(SettlementStatus.FAILED);
    expect(delivery.enqueueDelivery.mock.calls.map((call: any[]) => call[1])).not.toContain('settlement.completed');
  });
  it('rolls back confirmation when webhook enqueue fails', async () => {
    const payment = await create(); delivery.enqueueDelivery.mockRejectedValue(new Error('Queue unavailable'));
    await monitor.scanPendingPayments();
    expect((await state(payment.id)).status).toBe(PaymentStatus.PENDING);
    expect(alerts.raise).toHaveBeenCalled();
  });
  it('scopes membership by merchant and immediately applies key demotion/removal', async () => {
    const team = new TeamService(db.getRepository(MerchantMember), db.getRepository(Merchant));
    const member = await team.invite(merchant.id, 'Developer@example.com', MemberRole.DEVELOPER);
    await expect(team.invite(merchant.id, 'developer@example.com', MemberRole.VIEWER)).rejects.toThrow('already invited');
    const user = await team.context({ merchantId: randomUUID(), email: 'developer@example.com' }, merchant.id);
    const key = await team.key(user);
    expect((await team.authenticate(key.apiKey))?.scopes).toContain('payments:write');
    await team.update(merchant.id, member.id, MemberRole.VIEWER);
    expect((await team.authenticate(key.apiKey))?.scopes).not.toContain('payments:write');
    await expect(team.update(randomUUID(), member.id, MemberRole.OWNER)).rejects.toThrow('Member not found');
    await team.update(merchant.id, member.id);
    expect(await team.authenticate(key.apiKey)).toBeNull();
    await expect(team.context({ merchantId: randomUUID(), email: member.email }, merchant.id)).rejects.toThrow('membership required');
  });

});
