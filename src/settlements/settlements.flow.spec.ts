import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { SettlementsService } from "./settlements.service";
import { SettlementStatus } from "./entities/settlement.entity";
import { PaymentStatus } from "../payments/entities/payment.entity";

describe("SettlementsService dispatch and approval", () => {
  let service: SettlementsService;
  let repo: any;
  let payments: any;
  let hooks: any;
  let queue: any;
  let merchant: any;
  let alerts: any;
  beforeEach(() => {
    repo = {
      create: jest.fn((x) => ({ id: "s1", ...x })),
      save: jest.fn(async (x) => x),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    payments = { save: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    hooks = { dispatch: jest.fn() };
    queue = { add: jest.fn() };
    merchant = {
      findOne: jest
        .fn()
        .mockResolvedValue({ country: "NG", settlementFrequency: "INSTANT" }),
    };
    alerts = { raise: jest.fn() };
    service = new SettlementsService(
      repo,
      payments,
      new ConfigService({
        SETTLEMENT_PARTNER_URL: "https://partner.example",
        SETTLEMENT_PARTNER_API_KEY: "key",
      }),
      hooks,
      alerts,
      { clearCacheForMerchant: jest.fn() } as any,
      {} as any,
      merchant,
      {} as any,
      {} as any,
      queue,
      { run: async (_name: string, fn: () => Promise<unknown>) => fn() } as any,
      { settlement: { maxAttempts: 3, delaysMs: [60000] } } as any,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(["DAILY", "WEEKLY"])(
    "defers instant settlement for %s merchants",
    async (frequency) => {
      merchant.findOne.mockResolvedValue({ settlementFrequency: frequency });
      await service.initiateSettlement({
        id: "p1",
        merchantId: "m1",
        amountUsd: "100",
      } as any);
      expect(queue.add).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["US", "USD"],
    ["NG", "NGN"],
    ["GB", "GBP"],
    ["AU", "AUD"],
    ["XX", "USD"],
  ])("settles %s merchants in %s", async (country, currency) => {
    merchant.findOne.mockResolvedValue({ country });
    const payment = {
      id: "p1",
      merchantId: "m1",
      amountUsd: "100",
      status: PaymentStatus.CONFIRMED,
    };
    await service.initiateSettlement(payment as any);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fiatCurrency: currency,
        feeAmountUsd: "1.500000",
        netAmountUsd: "98.500000",
      }),
    );
    expect(payment.status).toBe(PaymentStatus.SETTLING);
    expect(queue.add).toHaveBeenCalledWith(
      "dispatch",
      { settlementId: "s1" },
      expect.objectContaining({ attempts: 4 }),
    );
  });
  it("requires approval for large settlements and does not enqueue a transfer", async () => {
    await service.initiateSettlement({
      id: "p1",
      merchantId: "m1",
      amountUsd: "20000",
    } as any);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: SettlementStatus.PENDING_APPROVAL }),
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(alerts.raise).toHaveBeenCalled();
  });
  it("dispatches the partner transfer and completed webhook", async () => {
    const settlement = {
      id: "s1",
      merchantId: "m1",
      status: SettlementStatus.PROCESSING,
      netAmountUsd: "98.5",
      fiatCurrency: "NGN",
    };
    repo.findOne.mockResolvedValue(settlement);
    jest.spyOn(axios, "post").mockResolvedValue({ data: {} });
    await service.processSettlement("s1");
    expect(axios.post).toHaveBeenCalledWith(
      "https://partner.example/transfers",
      expect.objectContaining({ reference: "s1", amount: "98.5" }),
      expect.anything(),
    );
    expect(settlement.status).toBe(SettlementStatus.COMPLETED);
    expect(hooks.dispatch).toHaveBeenCalledWith("m1", "settlement.completed", {
      settlementId: "s1",
    });
  });
  it("persists partner errors and raises an alert before rethrowing", async () => {
    const settlement = { id: "s1", status: SettlementStatus.PROCESSING };
    repo.findOne.mockResolvedValue(settlement);
    jest.spyOn(axios, "post").mockRejectedValue(new Error("bank unavailable"));
    await expect(service.processSettlement("s1")).rejects.toThrow(
      "bank unavailable",
    );
    expect(settlement.status).toBe(SettlementStatus.FAILED);
    expect(alerts.raise).toHaveBeenCalled();
  });
  it("does not dispatch a completed settlement twice", async () => {
    repo.findOne.mockResolvedValue({ status: SettlementStatus.COMPLETED });
    const post = jest.spyOn(axios, "post");
    await service.processSettlement("s1");
    expect(post).not.toHaveBeenCalled();
  });
  it("rejects unknown settlements", async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.processSettlement("missing")).rejects.toThrow(
      "not found",
    );
  });
  it("approves pending settlement and records the acting admin", async () => {
    repo.findOne.mockResolvedValue({
      id: "s1",
      status: SettlementStatus.PENDING_APPROVAL,
    });
    const result = await service.approveSettlement("s1", "admin1");
    expect(result).toMatchObject({
      approvedBy: "admin1",
      status: SettlementStatus.PROCESSING,
    });
    expect(queue.add).toHaveBeenCalled();
  });
  it("rejects approval of a completed settlement", async () => {
    repo.findOne.mockResolvedValue({ status: SettlementStatus.COMPLETED });
    await expect(service.approveSettlement("s1", "admin")).rejects.toThrow(
      "not awaiting approval",
    );
  });
  it("returns fee breakdown and CSV for a merchant", async () => {
    const settlement = {
      id: "s1",
      merchantId: "m1",
      totalAmountUsd: "100",
      feeAmountUsd: "1.5",
      netAmountUsd: "98.5",
      fiatCurrency: "NGN",
      createdAt: new Date("2026-01-01"),
    };
    repo.findOne.mockResolvedValue(settlement);
    repo.find.mockResolvedValue([settlement]);
    await expect(service.getFeeBreakdown("m1", "s1")).resolves.toMatchObject({
      feeRate: "0.015000",
      tierApplied: "standard",
    });
    expect(await service.exportCsvForMerchant("m1")).toContain(
      "s1,m1,100,0.015000,1.5,98.5,standard,NGN",
    );
  });
});
