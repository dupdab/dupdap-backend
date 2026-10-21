import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantSmsPhoneNumber1772500000001 implements MigrationInterface {
  name = 'AddMerchantSmsPhoneNumber1772500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "sms_phone_number" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchants" DROP COLUMN IF EXISTS "sms_phone_number"`,
    );
  }
}
