import { ConfigService } from "@nestjs/config";
import * as sdk from "@stellar/stellar-sdk";
import { StellarService, SorobanRpcException } from "./stellar.service";

describe("StellarService", () => {
  let service: StellarService;
  let cache: any;
  let alerts: any;
  let queue: any;
  let server: any;
  beforeEach(() => {
    cache = {
      get: jest.fn(),
      set: jest.fn(),
      getOrSet: jest.fn(async (_key, fetch) => ({ value: await fetch() })),
    };
    alerts = { raise: jest.fn() };
    queue = { submitPayment: jest.fn().mockResolvedValue("hash") };
    service = new StellarService(
      new ConfigService({ STELLAR_ACCOUNT_PUBLIC: "GDEPOSIT" }),
      cache,
      alerts,
      queue,
    );
    service.onModuleInit();
    server = service.getServer();
  });
  afterEach(() => jest.restoreAllMocks());

  it("exposes configured deposit address, USDC asset and memo", () => {
    expect(service.getDepositAddress()).toBe("GDEPOSIT");
    expect(service.getUsdcAsset().getCode()).toBe("USDC");
    expect(service.generateMemo()).toMatch(/^[A-Z0-9]{1,8}$/);
    expect(sdk.scValToNative(service.buildAssetTypeScVal("XLM"))).toEqual([
      "XLM",
    ]);
  });
  it("caches live orderbook prices and last-known-good rate", async () => {
    jest
      .spyOn(server, "orderbook")
      .mockReturnValue({
        call: async () => ({ asks: [{ price: "0.25" }] }),
      } as any);
    await expect(service.getXlmUsdRate()).resolves.toEqual({
      rate: 0.25,
      isFallback: false,
    });
    expect(cache.set).toHaveBeenCalledWith(
      "exchange-rate:xlm-usd:last-known-good",
      0.25,
      { ttlSeconds: 86400 },
    );
  });
  it.each([0.3, undefined])(
    "alerts and falls back after Horizon failure (%s)",
    async (cached) => {
      jest.spyOn(server, "orderbook").mockReturnValue({
        call: async () => {
          throw new Error("offline");
        },
      } as any);
      cache.get.mockResolvedValue(cached);
      await expect(service.getXlmUsdRate()).resolves.toEqual({
        rate: cached || 0.1,
        isFallback: true,
      });
      expect(alerts.raise).toHaveBeenCalled();
    },
  );
  it("falls back on an empty orderbook", async () => {
    jest
      .spyOn(server, "orderbook")
      .mockReturnValue({ call: async () => ({ asks: [] }) } as any);
    await expect(service.getXlmUsdRate()).resolves.toEqual({
      rate: 0.1,
      isFallback: true,
    });
  });
  it.each(["wrong", "memo"])(
    "verifies transaction memo %s against payment operations",
    async (memo) => {
      const tx = {
        memo,
        operations: async () => ({
          records: [
            {
              type: "payment",
              asset_type: "native",
              amount: "20",
              from: "sender",
            },
          ],
        }),
      };
      jest
        .spyOn(server, "transactions")
        .mockReturnValue({
          transaction: () => ({ call: async () => tx }),
        } as any);
      const result = await service.verifyPayment("hash", "memo");
      expect(result).toEqual(
        memo === "memo"
          ? { verified: true, amount: 20, asset: "XLM", from: "sender" }
          : { verified: false },
      );
      expect(await service.getPaymentsForTransaction("hash")).toHaveLength(1);
    },
  );
  it("returns unverified for failed transaction lookups", async () => {
    jest.spyOn(server, "transactions").mockImplementation(() => {
      throw new Error("offline");
    });
    await expect(service.verifyPayment("hash", "memo")).resolves.toEqual({
      verified: false,
    });
  });
  it("paginates account transactions with the supplied cursor", async () => {
    const builder: any = {
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: async () => ({ records: ["tx"] }),
    };
    jest.spyOn(server, "transactions").mockReturnValue(builder);
    expect(await service.getAccountTransactions("account", "cursor")).toEqual([
      "tx",
    ]);
    expect(builder.cursor).toHaveBeenCalledWith("cursor");
  });
  it("delegates payments to the serialized transaction queue", async () => {
    await expect(
      service.sendPayment("to", "1", sdk.Asset.native(), "memo"),
    ).resolves.toBe("hash");
    expect(queue.submitPayment).toHaveBeenCalledWith(
      "to",
      "1",
      sdk.Asset.native(),
      "memo",
    );
  });
  it("loads account balances", async () => {
    jest
      .spyOn(server, "accounts")
      .mockReturnValue({
        accountId: () => ({ call: async () => ({ balances: ["balance"] }) }),
      } as any);
    expect(await service.getBalance("account")).toEqual(["balance"]);
  });
  it("rejects contract invocation without contract configuration", async () => {
    await expect(service.invokeContract("deposit")).rejects.toBeInstanceOf(
      SorobanRpcException,
    );
    await expect(service.invokeContract("deposit")).rejects.toMatchObject({
      sorobanCode: "missing_contract_id",
    });
  });
  it("rejects a configured contract without a signer", async () => {
    service = new StellarService(
      new ConfigService({ SOROBAN_CONTRACT_ID: "contract" }),
      cache,
      alerts,
      queue,
    );
    service.onModuleInit();
    await expect(service.invokeContract("deposit")).rejects.toMatchObject({
      sorobanCode: "missing_signer",
    });
  });
});
