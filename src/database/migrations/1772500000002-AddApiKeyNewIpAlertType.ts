import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApiKeyNewIpAlertType1772500000002 implements MigrationInterface {
  name = 'AddApiKeyNewIpAlertType1772500000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."admin_alerts_type_enum" ADD VALUE IF NOT EXISTS 'api_key_new_ip'`);
  }

  async down(): Promise<void> {
    // PostgreSQL does not support removing enum values without rebuilding the type.
  }
}
