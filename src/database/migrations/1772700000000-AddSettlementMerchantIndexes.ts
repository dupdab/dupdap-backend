import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSettlementMerchantIndexes1772700000000
  implements MigrationInterface
{
  name = 'AddSettlementMerchantIndexes1772700000000';

  // CREATE INDEX CONCURRENTLY cannot run inside a transaction
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const settlementsTableExists = await queryRunner.hasTable('settlements');
    if (!settlementsTableExists) {
      return;
    }

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_SETTLEMENT_MERCHANT_ID"
      ON "settlements" ("merchantId")
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_SETTLEMENT_MERCHANT_STATUS"
      ON "settlements" ("merchantId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_SETTLEMENT_MERCHANT_STATUS"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_SETTLEMENT_MERCHANT_ID"`,
    );
  }
}
