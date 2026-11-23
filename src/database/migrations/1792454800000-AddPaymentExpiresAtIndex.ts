import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentExpiresAtIndex1792454800000 implements MigrationInterface {
  name = 'AddPaymentExpiresAtIndex1792454800000';

  // CREATE INDEX CONCURRENTLY cannot run inside a transaction
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_payments_expires_at"
      ON "payments" ("expiresAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_payments_expires_at"`,
    );
  }
}
