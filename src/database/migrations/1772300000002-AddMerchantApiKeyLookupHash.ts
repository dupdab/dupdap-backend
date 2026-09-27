import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantApiKeyLookupHash1772300000002 implements MigrationInterface {
  name = 'AddMerchantApiKeyLookupHash1772300000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD COLUMN "api_key_lookup_hash" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD CONSTRAINT "UQ_merchants_api_key_lookup_hash" UNIQUE ("api_key_lookup_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_merchants_api_key_lookup_hash" ON "merchants" ("api_key_lookup_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_merchants_api_key_lookup_hash"`);
    await queryRunner.query(
      `ALTER TABLE "merchants" DROP CONSTRAINT "UQ_merchants_api_key_lookup_hash"`,
    );
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN "api_key_lookup_hash"`);
  }
}
