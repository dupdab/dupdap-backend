import { MigrationInterface, QueryRunner } from 'typeorm';
import { EncryptionService } from '../../security/encryption.service';

export class EncryptPaymentCustomerEmail1795305600000 implements MigrationInterface {
  name = 'EncryptPaymentCustomerEmail1795305600000';

  // Encrypts legacy plaintext emails in place. Rows already holding an 'env1:' payload are skipped, so re-running is safe.
  // shortcut: loads all plaintext rows in one query, batch by id if payments grows large
  public async up(queryRunner: QueryRunner): Promise<void> {
    const encryption = new EncryptionService();
    const rows: Array<{ id: string; customerEmail: string }> = await queryRunner.query(`
      SELECT "id", "customerEmail" FROM "payments"
      WHERE "customerEmail" IS NOT NULL
        AND "customerEmail" <> ''
        AND "customerEmail" NOT LIKE 'env1:%'
    `);

    for (const row of rows) {
      await queryRunner.query(
        `UPDATE "payments" SET "customerEmail" = $1 WHERE "id" = $2`,
        [encryption.encrypt(row.customerEmail), row.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const encryption = new EncryptionService();
    const rows: Array<{ id: string; customerEmail: string }> = await queryRunner.query(`
      SELECT "id", "customerEmail" FROM "payments"
      WHERE "customerEmail" LIKE 'env1:%'
    `);

    for (const row of rows) {
      await queryRunner.query(
        `UPDATE "payments" SET "customerEmail" = $1 WHERE "id" = $2`,
        [encryption.decrypt(row.customerEmail), row.id],
      );
    }
  }
}
