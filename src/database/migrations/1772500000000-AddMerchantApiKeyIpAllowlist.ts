import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantApiKeyIpAllowlist1772500000000 implements MigrationInterface {
  name = 'AddMerchantApiKeyIpAllowlist1772500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchants" ADD COLUMN "api_key_ip_allowlist" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN "api_key_ip_allowlist"`);
  }
}
