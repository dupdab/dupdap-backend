import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStellarMemoIndex1792454800000 implements MigrationInterface {
  name = 'AddStellarMemoIndex1792454800000';

  // CREATE INDEX CONCURRENTLY cannot run inside a transaction
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const paymentsTableExists = await queryRunner.hasTable('payments');
    if (paymentsTableExists) {
      await queryRunner.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_payments_stellar_memo"
        ON "payments" ("stellarMemo")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_payments_stellar_memo"`,
    );
  }
}
