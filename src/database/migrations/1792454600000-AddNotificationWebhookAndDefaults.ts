import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationWebhookAndDefaults1792454600000 implements MigrationInterface {
  name = 'AddNotificationWebhookAndDefaults1792454600000';

  // New enum values must be committed before the backfill can use them
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notification_channel_enum" ADD VALUE IF NOT EXISTS 'webhook'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notification_event_type_enum" ADD VALUE IF NOT EXISTS 'payment.failed'`,
    );

    // Backfill existing merchants with the default email preferences
    await queryRunner.query(`
      INSERT INTO "notification_preferences" ("merchant_id", "channel", "event_type", "enabled")
      SELECT m."id", 'email', e.event_type::"notification_event_type_enum", true
      FROM "merchants" m
      CROSS JOIN (VALUES ('payment.confirmed'), ('payment.settled'), ('payment.failed')) AS e(event_type)
      ON CONFLICT ("merchant_id", "channel", "event_type") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop enum values in place; remove rows that use them instead
    await queryRunner.query(
      `DELETE FROM "notification_preferences" WHERE "channel" = 'webhook' OR "event_type" = 'payment.failed'`,
    );
  }
}
