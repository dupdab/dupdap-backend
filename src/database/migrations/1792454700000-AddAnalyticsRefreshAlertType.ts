import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalyticsRefreshAlertType1792454700000 implements MigrationInterface {
  name = 'AddAnalyticsRefreshAlertType1792454700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."admin_alerts_type_enum" ADD VALUE IF NOT EXISTS 'analytics_refresh'`);
  }

  async down(): Promise<void> {
    // PostgreSQL does not support removing enum values without rebuilding the type.
  }
}
