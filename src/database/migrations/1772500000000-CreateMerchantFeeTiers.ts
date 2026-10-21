import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMerchantFeeTiers1772500000000 implements MigrationInterface {
  name = 'CreateMerchantFeeTiers1772500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "merchant_fee_tiers" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "merchantId" uuid NOT NULL,
      "minimumVolumeUsd" numeric(18,2) NOT NULL DEFAULT 0,
      "feeRate" numeric(7,6) NOT NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_merchant_fee_tiers" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_merchant_fee_tiers_volume" UNIQUE ("merchantId", "minimumVolumeUsd"),
      CONSTRAINT "FK_merchant_fee_tiers_merchant" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "merchant_fee_tiers"`);
  }
}
