import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRecurringPaymentsTable1772400000003 implements MigrationInterface {
  name = 'CreateRecurringPaymentsTable1772400000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."recurring_payments_status_enum" AS ENUM('active', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "recurring_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "merchantId" character varying NOT NULL, "amountUsd" numeric(18,6) NOT NULL, "description" character varying, "intervalDays" integer NOT NULL, "status" "public"."recurring_payments_status_enum" NOT NULL DEFAULT 'active', "nextChargeAt" TIMESTAMP NOT NULL, "notifiedForChargeAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_recurring_payments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recurring_payments_merchantId" ON "recurring_payments" ("merchantId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recurring_payments_status_nextChargeAt" ON "recurring_payments" ("status", "nextChargeAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_payments" ADD CONSTRAINT "FK_recurring_payments_merchant" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recurring_payments" DROP CONSTRAINT "FK_recurring_payments_merchant"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_recurring_payments_status_nextChargeAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_recurring_payments_merchantId"`);
    await queryRunner.query(`DROP TABLE "recurring_payments"`);
    await queryRunner.query(`DROP TYPE "public"."recurring_payments_status_enum"`);
  }
}
