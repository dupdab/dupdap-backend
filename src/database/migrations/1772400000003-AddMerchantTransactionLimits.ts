import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantTransactionLimits1772400000003 implements MigrationInterface {
  name = 'AddMerchantTransactionLimits1772400000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD COLUMN "single_transaction_limit_usd" numeric(18,6) NOT NULL DEFAULT 10000`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD COLUMN "daily_limit_usd" numeric(18,6) NOT NULL DEFAULT 100000`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN "daily_limit_usd"`);
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN "single_transaction_limit_usd"`);
  }
}
