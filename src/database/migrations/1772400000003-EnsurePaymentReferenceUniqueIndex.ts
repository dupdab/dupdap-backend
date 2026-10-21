import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsurePaymentReferenceUniqueIndex1772400000003
  implements MigrationInterface
{
  name = 'EnsurePaymentReferenceUniqueIndex1772400000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const paymentsTableExists = await queryRunner.hasTable('payments');
    if (paymentsTableExists) {
      // Idempotent: the core domain migration already creates UQ_payments_reference
      // as a UNIQUE constraint (which is backed by an index of the same name).
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payments_reference"
        ON "payments" ("reference")
      `);
    }
  }

  public async down(): Promise<void> {
    // No-op: the unique constraint on payments.reference predates this migration
    // and must stay in place for the rest of the schema to hold.
  }
}
