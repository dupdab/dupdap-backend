import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillMissingEntityIndexes1772400000000
  implements MigrationInterface
{
  name = 'BackfillMissingEntityIndexes1772400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const settlementsTableExists = await queryRunner.hasTable('settlements');
    if (settlementsTableExists) {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_SETTLEMENT_MERCHANT_ID"
        ON "settlements" ("merchantId")
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_SETTLEMENT_STATUS"
        ON "settlements" ("status")
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_SETTLEMENT_MERCHANT_STATUS"
        ON "settlements" ("merchantId", "status")
      `);
    }

    const webhooksTableExists = await queryRunner.hasTable('webhooks');
    if (webhooksTableExists) {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_WEBHOOK_MERCHANT_ID"
        ON "webhooks" ("merchantId")
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_WEBHOOK_MERCHANT_ACTIVE"
        ON "webhooks" ("merchantId", "isActive")
      `);
    }

    const blockchainWalletsTableExists = await queryRunner.hasTable(
      'blockchain_wallets',
    );
    if (blockchainWalletsTableExists) {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_BLOCKCHAIN_WALLET_LAST_SYNCED_AT"
        ON "blockchain_wallets" ("lastSyncedAt")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_BLOCKCHAIN_WALLET_LAST_SYNCED_AT"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_WEBHOOK_MERCHANT_ACTIVE"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_WEBHOOK_MERCHANT_ID"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_SETTLEMENT_MERCHANT_STATUS"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_SETTLEMENT_STATUS"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_SETTLEMENT_MERCHANT_ID"`);
  }
}
