import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline schema for the core domain tables: merchants, settlements, payments, webhooks.
 * Idempotent (IF NOT EXISTS / guarded enum creation) so it is safe on databases that
 * already have these tables. Later migrations add merchants.api_key_scopes and
 * merchants.api_key_lookup_hash, so those columns are intentionally not created here.
 */
export class CreateCoreDomainTables1700000000000 implements MigrationInterface {
  name = 'CreateCoreDomainTables1700000000000';

  private async createEnum(queryRunner: QueryRunner, name: string, values: string[]) {
    const list = values.map((v) => `'${v}'`).join(', ');
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name}') THEN
          CREATE TYPE "public"."${name}" AS ENUM (${list});
        END IF;
      END $$
    `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await this.createEnum(queryRunner, 'merchants_status_enum', ['active', 'suspended', 'pending']);
    await this.createEnum(queryRunner, 'merchants_role_enum', ['admin', 'merchant', 'superadmin']);
    await this.createEnum(queryRunner, 'settlements_status_enum', [
      'pending',
      'pending_approval',
      'processing',
      'completed',
      'failed',
    ]);
    await this.createEnum(queryRunner, 'payments_network_enum', [
      'stellar',
      'polygon',
      'base',
      'celo',
      'arbitrum',
      'optimism',
      'starknet',
      'stacks',
    ]);
    await this.createEnum(queryRunner, 'payments_status_enum', [
      'pending',
      'confirmed',
      'settling',
      'settled',
      'failed',
      'expired',
      'refunded',
      'partially_refunded',
    ]);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "merchants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "passwordHash" character varying NOT NULL,
        "businessName" character varying NOT NULL,
        "businessType" character varying,
        "country" character varying,
        "bankAccountNumber" character varying,
        "bankCode" character varying,
        "bankName" character varying,
        "status" "public"."merchants_status_enum" NOT NULL DEFAULT 'pending',
        "role" "public"."merchants_role_enum" NOT NULL DEFAULT 'merchant',
        "apiKey" character varying,
        "apiKeyHash" character varying,
        "totalVolumeUsd" numeric(18,6) NOT NULL DEFAULT 0,
        "feeRate" numeric(5,4) NOT NULL DEFAULT 0.015,
        "custom_fee_rate" numeric(7,6) DEFAULT NULL,
        "sandboxMode" boolean NOT NULL DEFAULT false,
        "totpSecret" character varying,
        "totpEnabled" boolean NOT NULL DEFAULT false,
        "allowedIps" text,
        "paymentConfirmedEmailEnabled" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "UQ_merchants_email" UNIQUE ("email"),
        CONSTRAINT "PK_merchants_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "settlements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "merchantId" uuid NOT NULL,
        "totalAmountUsd" numeric(18,6) NOT NULL,
        "feeAmountUsd" numeric(18,6) NOT NULL,
        "netAmountUsd" numeric(18,6) NOT NULL,
        "fiatCurrency" character varying,
        "fiatAmount" numeric(18,6),
        "status" "public"."settlements_status_enum" NOT NULL DEFAULT 'pending',
        "partnerReference" character varying,
        "bankReference" character varying,
        "failureReason" character varying,
        "requiresApproval" boolean NOT NULL DEFAULT false,
        "approvedBy" character varying,
        "approvedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settlements_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_settlements_merchantId" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reference" character varying NOT NULL,
        "merchantId" uuid NOT NULL,
        "amountUsd" numeric(18,6) NOT NULL,
        "amountXlm" numeric(18,7),
        "amountUsdc" numeric(18,6),
        "currency" character varying,
        "network" "public"."payments_network_enum" NOT NULL DEFAULT 'stellar',
        "status" "public"."payments_status_enum" NOT NULL DEFAULT 'pending',
        "stellarDepositAddress" character varying,
        "stellarMemo" character varying,
        "customerWalletAddress" character varying,
        "txHash" character varying,
        "description" character varying,
        "customerEmail" character varying,
        "metadata" jsonb,
        "qrCode" character varying,
        "feeUsd" numeric(18,6),
        "settlementAmountFiat" numeric(18,6),
        "settlementCurrency" character varying,
        "expiresAt" TIMESTAMP,
        "expiryLedger" integer,
        "confirmedAt" TIMESTAMP,
        "refundAmountUsd" numeric(18,6),
        "refundReason" character varying,
        "refundTxHash" character varying,
        "refundedAt" TIMESTAMP,
        "settlementId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "UQ_payments_reference" UNIQUE ("reference"),
        CONSTRAINT "PK_payments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payments_merchantId" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_payments_settlementId" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payments_merchantId" ON "payments" ("merchantId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payments_merchantId_status" ON "payments" ("merchantId", "status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payments_merchantId_createdAt" ON "payments" ("merchantId", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhooks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "merchantId" uuid NOT NULL,
        "url" character varying NOT NULL,
        "events" text NOT NULL,
        "secret" character varying,
        "isActive" boolean NOT NULL DEFAULT true,
        "failureCount" integer NOT NULL DEFAULT 0,
        "lastDeliveredAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhooks_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_webhooks_merchantId" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "webhooks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "settlements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "merchants"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."payments_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."payments_network_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."settlements_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."merchants_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."merchants_status_enum"`);
  }
}
