import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantEmailVerified1792454800000 implements MigrationInterface {
  name = 'AddMerchantEmailVerified1792454800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "emailVerified" boolean NOT NULL DEFAULT false`);
    // Existing merchants predate verification; keep them live rather than locking them into sandbox.
    await queryRunner.query(`UPDATE "merchants" SET "emailVerified" = true`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchants" DROP COLUMN IF EXISTS "emailVerified"`);
  }
}
