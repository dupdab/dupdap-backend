import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the encryption key version to Stellar wallet records (#444).
 *
 * `keyVersion` records which `ENCRYPTION_KEY` version encrypted the stored
 * secret so the rotation job can re-encrypt the record with the active key
 * and retire the old one.
 */
export class AddWalletKeyVersion1792454600000 implements MigrationInterface {
  name = 'AddWalletKeyVersion1792454600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blockchain_wallets" ADD COLUMN IF NOT EXISTS "keyVersion" integer NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blockchain_wallets" DROP COLUMN IF EXISTS "keyVersion"`,
    );
  }
}
