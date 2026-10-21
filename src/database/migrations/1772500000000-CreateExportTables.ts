import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExportTables1772500000000 implements MigrationInterface {
  name = 'CreateExportTables1772500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "settlement_exports" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "merchantId" character varying NOT NULL,
      "recipientEmail" character varying NOT NULL,
      "deliveryBaseUrl" character varying NOT NULL,
      "dateFrom" character varying(10),
      "dateTo" character varying(10),
      "status" character varying NOT NULL DEFAULT 'queued',
      "fileName" character varying,
      "fileData" bytea,
      "downloadToken" character varying,
      "expiresAt" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_settlement_exports_id" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_settlement_exports_downloadToken" UNIQUE ("downloadToken")
    )`);
    await queryRunner.query(`CREATE TYPE "analytics_exports_format_enum" AS ENUM('pdf', 'csv', 'json')`);
    await queryRunner.query(`CREATE TYPE "analytics_exports_scope_enum" AS ENUM('merchant', 'admin')`);
    await queryRunner.query(
      `CREATE TYPE "analytics_exports_status_enum" AS ENUM('queued', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(`CREATE TABLE "analytics_exports" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "format" "analytics_exports_format_enum" NOT NULL,
      "scope" "analytics_exports_scope_enum" NOT NULL,
      "status" "analytics_exports_status_enum" NOT NULL DEFAULT 'queued',
      "requestedByMerchantId" character varying NOT NULL,
      "merchantId" character varying,
      "recipientEmail" character varying NOT NULL,
      "merchantBusinessName" character varying NOT NULL,
      "period" character varying(16) NOT NULL,
      "dateFrom" character varying(10),
      "dateTo" character varying(10),
      "deliveryBaseUrl" character varying NOT NULL,
      "fileName" character varying,
      "fileData" bytea,
      "downloadToken" character varying,
      "expiresAt" TIMESTAMP WITH TIME ZONE,
      "errorMessage" text,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_analytics_exports_id" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_analytics_exports_downloadToken" UNIQUE ("downloadToken")
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "settlement_exports"`);
    await queryRunner.query(`DROP TABLE "analytics_exports"`);
    await queryRunner.query(`DROP TYPE "analytics_exports_status_enum"`);
    await queryRunner.query(`DROP TYPE "analytics_exports_scope_enum"`);
    await queryRunner.query(`DROP TYPE "analytics_exports_format_enum"`);
  }
}
