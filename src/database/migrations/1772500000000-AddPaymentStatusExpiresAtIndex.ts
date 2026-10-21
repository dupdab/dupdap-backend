import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentStatusExpiresAtIndex1772500000000
  implements MigrationInterface
{
  name = 'AddPaymentStatusExpiresAtIndex1772500000000';

  // CREATE INDEX CONCURRENTLY cannot run inside a transaction
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const paymentsTableExists = await queryRunner.hasTable('payments');
    if (paymentsTableExists) {
      await queryRunner.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_payments_status_expires_at"
        ON "payments" ("status", "expiresAt")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_payments_status_expires_at"`,
    );
  }
}
