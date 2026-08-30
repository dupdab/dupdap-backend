import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthAndWaitlistFields1772400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "passwordResetToken" varchar');
    await queryRunner.query('ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" timestamptz');
    await queryRunner.query('ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "approved" boolean NOT NULL DEFAULT false');
    await queryRunner.query('ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "unsubscribed" boolean NOT NULL DEFAULT false');
    await queryRunner.query('ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "referralCount" integer NOT NULL DEFAULT 0');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "waitlist" DROP COLUMN IF EXISTS "referralCount", DROP COLUMN IF EXISTS "unsubscribed", DROP COLUMN IF EXISTS "approved"');
    await queryRunner.query('ALTER TABLE "merchants" DROP COLUMN IF EXISTS "passwordResetExpiresAt", DROP COLUMN IF EXISTS "passwordResetToken"');
  }
}
