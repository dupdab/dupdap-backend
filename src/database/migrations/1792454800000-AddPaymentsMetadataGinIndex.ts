import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentsMetadataGinIndex1792454800000
  implements MigrationInterface
{
  name = 'AddPaymentsMetadataGinIndex1792454800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const paymentsTableExists = await queryRunner.hasTable('payments');
    if (!paymentsTableExists) {
      return;
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payments_metadata_gin"
      ON "payments" USING GIN ("metadata" jsonb_path_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_metadata_gin"`);
  }
}
