import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentEventsTable1772400000002 implements MigrationInterface {
  name = 'CreatePaymentEventsTable1772400000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."payment_events_eventtype_enum" AS ENUM('created', 'status_changed', 'confirmed', 'expired', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "paymentId" character varying NOT NULL, "eventType" "public"."payment_events_eventtype_enum" NOT NULL, "previousStatus" character varying, "newStatus" character varying, "actorId" character varying, "timestamp" TIMESTAMP NOT NULL DEFAULT now(), "metadata" jsonb, CONSTRAINT "PK_payment_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payment_events_paymentId" ON "payment_events" ("paymentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payment_events_payment_time" ON "payment_events" ("paymentId", "timestamp")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_payment_events_payment_time"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payment_events_paymentId"`);
    await queryRunner.query(`DROP TABLE "payment_events"`);
    await queryRunner.query(`DROP TYPE "public"."payment_events_eventtype_enum"`);
  }
}
