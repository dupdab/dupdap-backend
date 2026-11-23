import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateSorobanIndexerCursors1792454800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'soroban_indexer_cursors',
        columns: [
          { name: 'name', type: 'varchar', length: '100', isPrimary: true },
          { name: 'ledger', type: 'int', default: 0 },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('soroban_indexer_cursors');
  }
}
