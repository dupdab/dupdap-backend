import { MigrationInterface, QueryRunner } from 'typeorm';
import { EncryptionService } from '../../security/encryption.service';

/**
 * Encrypts existing plaintext `payments.customerEmail` values in place.
 *
 * The column transformer only encrypts on write, so rows written before the
 * transformer was applied stay in plaintext. This migration reads each row,
 * encrypts the value with the same EncryptionService used by the transformer,
 * and writes it back. Already-encrypted values (encv1: prefix) are skipped so
 * the migration is idempotent.
 */
export class EncryptPaymentCustomerEmail1772200000013
  implements MigrationInterface
{
  name = 'EncryptPaymentCustomerEmail1772200000013';

  private static readonly BATCH_SIZE = 500;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('payments');
    if (!tableExists) return;

    const encryption = EncryptionService.getInstance();
    let lastId: string | null = null;

    for (;;) {
      const rows: Array<{ id: string; customerEmail: string | null }> =
        await queryRunner.query(
          `SELECT "id", "customerEmail" FROM "payments"
           WHERE "customerEmail" IS NOT NULL
             AND "customerEmail" <> ''
             AND "customerEmail" NOT LIKE 'encv1:%'
             ${lastId ? 'AND "id" > $1' : ''}
           ORDER BY "id" ASC
           LIMIT ${EncryptPaymentCustomerEmail1772200000013.BATCH_SIZE}`,
          lastId ? [lastId] : [],
        );

      if (rows.length === 0) break;

      for (const row of rows) {
        await queryRunner.query(
          `UPDATE "payments" SET "customerEmail" = $1 WHERE "id" = $2`,
          [encryption.encrypt(row.customerEmail as string), row.id],
        );
      }

      lastId = rows[rows.length - 1].id;
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('payments');
    if (!tableExists) return;

    const encryption = EncryptionService.getInstance();
    let lastId: string | null = null;

    for (;;) {
      const rows: Array<{ id: string; customerEmail: string | null }> =
        await queryRunner.query(
          `SELECT "id", "customerEmail" FROM "payments"
           WHERE "customerEmail" LIKE 'encv1:%'
             ${lastId ? 'AND "id" > $1' : ''}
           ORDER BY "id" ASC
           LIMIT ${EncryptPaymentCustomerEmail1772200000013.BATCH_SIZE}`,
          lastId ? [lastId] : [],
        );

      if (rows.length === 0) break;

      for (const row of rows) {
        await queryRunner.query(
          `UPDATE "payments" SET "customerEmail" = $1 WHERE "id" = $2`,
          [encryption.decrypt(row.customerEmail as string), row.id],
        );
      }

      lastId = rows[rows.length - 1].id;
    }
  }
}
