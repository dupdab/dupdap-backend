import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateQueueMetrics1792454500000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE queue_metrics (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name varchar NOT NULL,
      completed integer NOT NULL DEFAULT 0, failed integer NOT NULL DEFAULT 0,
      waiting integer NOT NULL DEFAULT 0, active integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async down(runner: QueryRunner): Promise<void> { await runner.query('DROP TABLE queue_metrics'); }
}
