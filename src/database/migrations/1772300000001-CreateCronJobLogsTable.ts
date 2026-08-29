import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateCronJobLogsTable1772300000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "cron_job_status_enum" AS ENUM('started', 'completed', 'failed', 'skipped')`);

    await queryRunner.createTable(
      new Table({
        name: 'cron_job_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'jobName',
            type: 'varchar',
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['started', 'completed', 'failed', 'skipped'],
            default: `'started'`,
          },
          {
            name: 'started_at',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'completed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'duration_ms',
            type: 'int',
          },
          {
            name: 'error_message',
            type: 'varchar',
            length: '1000',
            isNullable: true,
          },
          {
            name: 'items_processed',
            type: 'int',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'cron_job_logs',
      new TableIndex({
        name: 'IDX_cron_job_logs_jobName_startedAt',
        columnNames: ['jobName', 'started_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('cron_job_logs', 'IDX_cron_job_logs_jobName_startedAt');
    await queryRunner.dropTable('cron_job_logs');
    await queryRunner.query('DROP TYPE "cron_job_status_enum"');
  }
}
