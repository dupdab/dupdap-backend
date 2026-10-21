import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnablePgStatStatements1772400000003 implements MigrationInterface {
  name = 'EnablePgStatStatements1772400000003';

  // pg_stat_statements also requires `shared_preload_libraries` on the server;
  // this only creates the extension and its views. See docs/query-plans.md.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS pg_stat_statements`);
  }
}
