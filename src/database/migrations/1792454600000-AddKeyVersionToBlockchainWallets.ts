import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKeyVersionToBlockchainWallets1792454600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'blockchain_wallets',
      new (require('typeorm').TableColumn)({
        name: 'key_version',
        type: 'int',
        default: 1,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('blockchain_wallets', 'key_version');
  }
}
