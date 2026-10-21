import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantWebhookRetryConfig1772500000000 implements MigrationInterface {
  name = 'AddMerchantWebhookRetryConfig1772500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchants" ADD "webhook_retry_config" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN "webhook_retry_config"`);
  }
}
