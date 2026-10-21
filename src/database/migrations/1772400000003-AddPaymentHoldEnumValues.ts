import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentHoldEnumValues1772400000003 implements MigrationInterface {
  name = 'AddPaymentHoldEnumValues1772400000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."payments_status_enum" ADD VALUE IF NOT EXISTS 'held'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."payment_events_eventtype_enum" ADD VALUE IF NOT EXISTS 'held'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."payment_events_eventtype_enum" ADD VALUE IF NOT EXISTS 'released'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values; down is a no-op
  }
}
