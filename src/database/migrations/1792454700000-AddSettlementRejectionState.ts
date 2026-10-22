import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the settlement rejection state (#445).
 *
 * Large settlements (> $10,000) wait in `pending_approval` until a SUPERADMIN
 * approves or rejects them. Rejected settlements are stored with the deciding
 * admin and the reason that is shown to the merchant.
 */
export class AddSettlementRejectionState1792454700000 implements MigrationInterface {
  name = 'AddSettlementRejectionState1792454700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."settlements_status_enum" ADD VALUE IF NOT EXISTS 'rejected'`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "rejectedBy" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "rejectionReason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN IF EXISTS "rejectionReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN IF EXISTS "rejectedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN IF EXISTS "rejectedBy"`,
    );
    // PostgreSQL cannot remove an enum value without rebuilding the type.
  }
}
