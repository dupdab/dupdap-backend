import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmsNotificationChannel1772500000000 implements MigrationInterface {
  name = 'AddSmsNotificationChannel1772500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notification_channel_enum" ADD VALUE IF NOT EXISTS 'sms'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop an enum value in place, so rebuild the type without 'sms'
    await queryRunner.query(
      `DELETE FROM "notification_preferences" WHERE "channel" = 'sms'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notification_channel_enum" RENAME TO "notification_channel_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "notification_channel_enum" AS ENUM ('email', 'push', 'in_app')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_preferences" ALTER COLUMN "channel" TYPE "notification_channel_enum" USING "channel"::text::"notification_channel_enum"`,
    );
    await queryRunner.query(`DROP TYPE "notification_channel_enum_old"`);
  }
}
