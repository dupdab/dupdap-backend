import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminAlertResolve1772400000002 implements MigrationInterface {
  name = 'AddAdminAlertResolve1772400000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."admin_alerts_status_enum" ADD VALUE IF NOT EXISTS 'resolved'`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_alerts" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_alerts" ADD COLUMN IF NOT EXISTS "resolved_by" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admin_alerts" DROP COLUMN IF EXISTS "resolved_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_alerts" DROP COLUMN IF EXISTS "resolved_at"`,
    );
  }
}
