import { MigrationInterface, QueryRunner } from 'typeorm';

export class MerchantSuspensionAndPaymentSearch1772500000000 implements MigrationInterface {
  name = 'MerchantSuspensionAndPaymentSearch1772500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "suspended" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "suspendedReason" text`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payments_stellar_memo" ON "payments" ("stellarMemo")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payments_metadata_gin" ON "payments" USING GIN ("metadata")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_metadata_gin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_stellar_memo"`);
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN IF EXISTS "suspendedReason"`);
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN IF EXISTS "suspended"`);
  }
}
