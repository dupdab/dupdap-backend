import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDeletesToAuditEntities1772600000000 implements MigrationInterface {
  name = 'AddSoftDeletesToAuditEntities1772600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "webhooks" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "settlements" DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE "webhooks" DROP COLUMN IF EXISTS "deletedAt"`);
  }
}
