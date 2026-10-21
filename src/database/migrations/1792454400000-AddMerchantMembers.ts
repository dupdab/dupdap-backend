import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddMerchantMembers1792454400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TYPE merchant_member_role AS ENUM ('OWNER', 'DEVELOPER', 'VIEWER')`);
    await runner.query(`CREATE TABLE merchant_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "merchantId" uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      email varchar NOT NULL,
      role merchant_member_role NOT NULL,
      "apiKeyHash" varchar,
      UNIQUE ("merchantId", email)
    )`);
    await runner.query(`CREATE UNIQUE INDEX merchant_members_key ON merchant_members ("apiKeyHash") WHERE "apiKeyHash" IS NOT NULL`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE merchant_members');
    await runner.query('DROP TYPE merchant_member_role');
  }
}
