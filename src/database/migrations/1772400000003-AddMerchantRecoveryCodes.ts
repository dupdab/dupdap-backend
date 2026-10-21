import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantRecoveryCodes1772400000003 implements MigrationInterface {
  name = 'AddMerchantRecoveryCodes1772400000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "recovery_code_hashes" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchants" DROP COLUMN IF EXISTS "recovery_code_hashes"`,
    );
  }
}
