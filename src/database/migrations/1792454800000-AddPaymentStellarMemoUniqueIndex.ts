import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentStellarMemoUniqueIndex1792454800000 implements MigrationInterface {
  name = 'AddPaymentStellarMemoUniqueIndex1792454800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Partial unique index: stellarMemo is nullable, and NULLs must not collide.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payments_stellar_memo" ON "payments" ("stellarMemo") WHERE "stellarMemo" IS NOT NULL`,
    );
    // The unique index serves the same memo lookups as the plain index it replaces.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_stellar_memo"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payments_stellar_memo" ON "payments" ("stellarMemo")`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_payments_stellar_memo"`);
  }
}
