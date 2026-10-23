import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookCircuitOpenUntil1792454600000 implements MigrationInterface {
  name = 'AddWebhookCircuitOpenUntil1792454600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "webhooks" ADD COLUMN IF NOT EXISTS "circuitOpenUntil" timestamptz`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "webhooks" DROP COLUMN IF EXISTS "circuitOpenUntil"`);
  }
}
