import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceInAppNotificationReadWithReadAt1772500000000 implements MigrationInterface {
  name = 'ReplaceInAppNotificationReadWithReadAt1772500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "in_app_notifications" ADD COLUMN "readAt" timestamptz`);
    await queryRunner.query(
      `UPDATE "in_app_notifications" SET "readAt" = "createdAt" WHERE "read" = true`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_in_app_notifications_merchant_read"`);
    await queryRunner.query(`ALTER TABLE "in_app_notifications" DROP COLUMN "read"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_in_app_notifications_merchant_read_at" ON "in_app_notifications" ("merchantId", "readAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_in_app_notifications_merchant_read_at"`);
    await queryRunner.query(
      `ALTER TABLE "in_app_notifications" ADD COLUMN "read" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "in_app_notifications" SET "read" = true WHERE "readAt" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "in_app_notifications" DROP COLUMN "readAt"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_in_app_notifications_merchant_read" ON "in_app_notifications" ("merchantId", "read")`,
    );
  }
}
