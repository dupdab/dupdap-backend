import { MigrationInterface, QueryRunner } from 'typeorm';

export class ComplianceWorkflows1772500000000 implements MigrationInterface {
  name = 'ComplianceWorkflows1772500000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."merchants_kyc_status_enum" AS ENUM('UNVERIFIED','PENDING','VERIFIED','REJECTED')`);
    await queryRunner.query(`ALTER TABLE "merchants" ADD "kycStatus" "public"."merchants_kyc_status_enum" NOT NULL DEFAULT 'UNVERIFIED'`);
    await queryRunner.query(`ALTER TABLE "merchants" ADD "kycDocuments" jsonb`);
    await queryRunner.query(`CREATE TABLE "merchant_bank_accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "merchantId" character varying NOT NULL, "currency" character varying(3) NOT NULL, "accountNumber" character varying NOT NULL, "routingNumber" character varying NOT NULL, "isDefault" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_merchant_bank_accounts" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_merchant_bank_accounts_merchant_currency_default" ON "merchant_bank_accounts" ("merchantId", "currency", "isDefault")`);
    await queryRunner.query(`CREATE TYPE "public"."payment_disputes_status_enum" AS ENUM('OPEN','UNDER_REVIEW','RESOLVED','ESCALATED')`);
    await queryRunner.query(`CREATE TABLE "payment_disputes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "paymentId" character varying NOT NULL, "merchantId" character varying NOT NULL, "raisedBy" character varying NOT NULL, "reason" text NOT NULL, "status" "public"."payment_disputes_status_enum" NOT NULL DEFAULT 'OPEN', "slaDeadline" TIMESTAMPTZ NOT NULL, "resolution" text, "reviewedBy" character varying, "resolvedAt" TIMESTAMPTZ, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_payment_disputes" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_disputes_payment_status" ON "payment_disputes" ("paymentId", "status")`);
    await queryRunner.query(`ALTER TABLE "aml_flags" ADD "slaDeadline" TIMESTAMP`);
    await queryRunner.query(`UPDATE "aml_flags" SET "slaDeadline" = "createdAt" + interval '24 hours' WHERE "slaDeadline" IS NULL`);
    await queryRunner.query(`ALTER TABLE "aml_flags" ALTER COLUMN "slaDeadline" SET NOT NULL`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "aml_flags" DROP COLUMN "slaDeadline"`);
    await queryRunner.query(`DROP INDEX "IDX_payment_disputes_payment_status"`);
    await queryRunner.query(`DROP TABLE "payment_disputes"`);
    await queryRunner.query(`DROP TYPE "public"."payment_disputes_status_enum"`);
    await queryRunner.query(`DROP INDEX "IDX_merchant_bank_accounts_merchant_currency_default"`);
    await queryRunner.query(`DROP TABLE "merchant_bank_accounts"`);
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN "kycDocuments"`);
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN "kycStatus"`);
    await queryRunner.query(`DROP TYPE "public"."merchants_kyc_status_enum"`);
  }
}
