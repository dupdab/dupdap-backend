import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentGeoFields1772400000003 implements MigrationInterface {
  name = 'AddPaymentGeoFields1772400000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ADD "customerIp" character varying`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "countryCode" character varying(2)`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "geoFlagged" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "geoFlagged"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "countryCode"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "customerIp"`);
  }
}
