import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantApiKeyLastFour1772500000001 implements MigrationInterface {
  name = 'AddMerchantApiKeyLastFour1772500000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchants" ADD COLUMN "api_key_last_four" character varying(4)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN "api_key_last_four"`);
  }
}
