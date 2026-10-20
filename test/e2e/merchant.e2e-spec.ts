/** Real PostgreSQL repositories and Redis queues; only external network boundaries are stubbed. */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { Queue } from "bull";
import Bull = require("bull");
import request = require("supertest");
import { createServer, Server } from "node:http";
import axios from "axios";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { JwtStrategy } from "../../src/auth/strategies/jwt.strategy";
import { RateLimitService } from "../../src/auth/rate-limit.service";
import { PaymentsController } from "../../src/payments/payments.controller";
import { PaymentsService } from "../../src/payments/payments.service";
import { SettlementsService } from "../../src/settlements/settlements.service";
import { WebhooksService } from "../../src/webhooks/webhooks.service";
import { CacheService } from "../../src/cache/cache.service";
import { Merchant } from "../../src/merchants/entities/merchant.entity";
import {
  Payment,
  PaymentStatus,
} from "../../src/payments/entities/payment.entity";
import { PaymentEvent } from "../../src/payments/entities/payment-event.entity";
import {
  Settlement,
  SettlementStatus,
} from "../../src/settlements/entities/settlement.entity";
import { Webhook } from "../../src/webhooks/entities/webhook.entity";
import { PaymentEscrowService } from "../../src/blockchain-wallet/payment-escrow.service";
import { EncryptionService } from "../../src/security/encryption.service";
import { setEncryptionServiceInstance } from "../../src/security/encrypted-column.transformer";
import { CorrelationIdMiddleware } from "../../src/common/middleware/correlation-id.middleware";

// Explicitly use disposable infrastructure. Never accept the application's database URL.
process.env.NODE_ENV = "test";
process.env.REDIS_URL = "redis://127.0.0.1:6380/15";
process.env.ENCRYPTION_KEY = "11".repeat(32);

describe("merchant onboarding to first settlement", () => {
  let app: INestApplication;
  let db: DataSource;
  let cache: CacheService;
  let settlements: SettlementsService;
  let payments: PaymentsService;
  let queue: Queue;
  let receiver: Server;
  let receiverUrl: string;
  const received: Array<{ event: string; data: Record<string, string> }> = [];

  beforeAll(async () => {
    setEncryptionServiceInstance(new EncryptionService());
    db = await new DataSource({
      type: "postgres",
      host: "127.0.0.1",
      port: 5433,
      username: "postgres",
      password: "postgres",
      database: "dupdub_test",
      entities: [Merchant, Payment, PaymentEvent, Settlement, Webhook],
      synchronize: true,
      dropSchema: true,
    }).initialize();
    cache = new CacheService();
    await cache.onModuleInit();
    await cache.flushAll();
    // Seed a second tenant before this suite, to verify authorization isolation.
    await db
      .getRepository(Merchant)
      .save({
        email: "other@example.com",
        passwordHash: "unused",
        businessName: "Other tenant",
      });
    receiver = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) =>
      receiver.listen(0, "127.0.0.1", resolve),
    );
    receiverUrl = `http://127.0.0.1:${(receiver.address() as any).port}`;
    queue = new Bull("merchant-e2e-settlement", {
      redis: { host: "127.0.0.1", port: 6380, db: 15 },
    });
    await queue.empty();
    const webhooks = new WebhooksService(db.getRepository(Webhook), {
      // The external HTTPS delivery boundary is replaced by a real local HTTP receiver.
      enqueueDelivery: async (hook: Webhook, _event: string, body: string) => {
        await axios.post(hook.url, body, {
          headers: { "Content-Type": "application/json" },
        });
      },
    } as any);
    const analytics = { clearCacheForMerchant: jest.fn() };
    payments = new PaymentsService(
      db.getRepository(Payment),
      db.getRepository(PaymentEvent),
      {
        getXlmUsdRate: async () => ({ rate: 0.1, isFallback: false }),
        generateMemo: () => "E2EMEMO",
        getDepositAddress: () => "GE2E",
      } as any,
      webhooks,
      {} as any,
      {} as any,
      new PaymentEscrowService({} as any),
      analytics as any,
      db,
    );
    settlements = new SettlementsService(
      db.getRepository(Settlement),
      db.getRepository(Payment),
      new ConfigService({
        SETTLEMENT_PARTNER_URL: receiverUrl,
        SETTLEMENT_PARTNER_API_KEY: "test-key",
      }),
      webhooks,
      { raise: jest.fn() } as any,
      analytics as any,
      {} as any,
      {
        findOne: (id: string) =>
          db.getRepository(Merchant).findOneByOrFail({ id }),
      } as any,
      {} as any,
      {} as any,
      queue,
      {} as any,
      { settlement: { maxAttempts: 0, delaysMs: [1] } } as any,
    );
    const config = new ConfigService({ JWT_SECRET: "e2e-only-secret" });
    const fixture = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: "e2e-only-secret",
          signOptions: { expiresIn: "1h" },
        }),
      ],
      controllers: [AuthController, PaymentsController],
      providers: [
        AuthService,
        JwtStrategy,
        RateLimitService,
        { provide: ConfigService, useValue: config },
        { provide: CacheService, useValue: cache },
        { provide: PaymentsService, useValue: payments },
        {
          provide: getRepositoryToken(Merchant),
          useValue: db.getRepository(Merchant),
        },
      ],
    }).compile();
    app = fixture.createNestApplication();
    app.use(
      new CorrelationIdMiddleware().use.bind(new CorrelationIdMiddleware()),
    );
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    queue.process("dispatch", async (job) =>
      settlements.processSettlement(job.data.settlementId),
    );
  });

  afterAll(async () => {
    await queue?.close();
    await app?.close();
    if (!app) await cache?.onModuleDestroy();
    await db?.destroy();
    if (receiver)
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
  });

  it("registers, logs in, creates, confirms, dispatches settlement and receives a webhook", async () => {
    const credentials = {
      email: "merchant@example.com",
      password: "SecurePass123!",
    };
    const registered = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ ...credentials, businessName: "E2E", country: "NG" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ ...credentials, businessName: "Duplicate" })
      .expect(409);
    await db
      .getRepository(Webhook)
      .save({
        merchantId: registered.body.merchant.id,
        url: receiverUrl + "/webhook",
        events: ["*"],
        secret: "e2e-secret",
      });
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send(credentials)
      .expect(200);
    expect(login.body.accessToken).toBeTruthy();
    await request(app.getHttpServer())
      .post("/payments")
      .send({ amountUsd: 100 })
      .expect(401);
    const created = await request(app.getHttpServer())
      .post("/payments")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ amountUsd: 100 })
      .expect(201);
    expect(created.headers["x-request-id"]).toBeTruthy();
    expect(created.body.status).toBe(PaymentStatus.PENDING);
    // Confirmation is an internal contract/monitor action, not a merchant HTTP endpoint.
    const confirmed = await payments.confirmPayment(
      created.body.id,
      "GCUSTOMER",
    );
    expect(confirmed.status).toBe(PaymentStatus.CONFIRMED);
    await settlements.initiateSettlement(confirmed);
    const deadline = Date.now() + 10000;
    while (
      !received.some((event) => event.event === "settlement.completed") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const saved = await db
      .getRepository(Payment)
      .findOneByOrFail({ id: created.body.id });
    const settlement = await db
      .getRepository(Settlement)
      .findOneByOrFail({ id: saved.settlementId });
    expect(settlement).toMatchObject({
      merchantId: registered.body.merchant.id,
      status: SettlementStatus.COMPLETED,
    });
    expect(Number(settlement.feeAmountUsd)).toBe(1.5);
    expect(Number(settlement.netAmountUsd)).toBe(98.5);
    expect(received).toContainEqual(
      expect.objectContaining({
        event: "settlement.completed",
        data: { settlementId: settlement.id },
      }),
    );
    expect(
      await db.getRepository(PaymentEvent).countBy({ paymentId: saved.id }),
    ).toBe(2);
  });
});
