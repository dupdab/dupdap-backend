import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentMerchantStatusCreatedAtIndex1772500000001
  implements MigrationInterface
{
  name = 'AddPaymentMerchantStatusCreatedAtIndex1772500000001';

  // CREATE INDEX CONCURRENTLY cannot run inside a transaction
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const paymentsTableExists = await queryRunner.hasTable('payments');
    if (paymentsTableExists) {
      await queryRunner.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_payments_merchant_status_created_at"
        ON "payments" ("merchantId", "status", "createdAt")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_payments_merchant_status_created_at"`,
    );
  }
}
