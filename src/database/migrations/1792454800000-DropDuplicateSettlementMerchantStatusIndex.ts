import { MigrationInterface, QueryRunner } from 'typeorm';

// IDX_SETTLEMENT_MERCHANT_STATUS (entity-declared) already indexes the same columns.
export class DropDuplicateSettlementMerchantStatusIndex1792454800000 implements MigrationInterface {
  name = 'DropDuplicateSettlementMerchantStatusIndex1792454800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_settlements_merchant_status"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_settlements_merchant_status"
      ON "settlements" ("merchantId", "status")
    `);
  }
}
