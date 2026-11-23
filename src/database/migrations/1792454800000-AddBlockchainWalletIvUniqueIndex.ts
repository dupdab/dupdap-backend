import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlockchainWalletIvUniqueIndex1792454800000
  implements MigrationInterface
{
  name = 'AddBlockchainWalletIvUniqueIndex1792454800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Partial: new wallets store iv = NULL, so only populated IVs must be unique.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_BLOCKCHAIN_WALLET_IV"
      ON "blockchain_wallets" ("iv")
      WHERE "iv" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BLOCKCHAIN_WALLET_IV"`);
  }
}
