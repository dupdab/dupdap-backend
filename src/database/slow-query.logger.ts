import { Logger } from '@nestjs/common';
import { Counter } from 'prom-client';
import { QueryRunner } from 'typeorm';
import { AdvancedConsoleLogger } from 'typeorm/logger/AdvancedConsoleLogger';

/** Prometheus counter of queries slower than DB_SLOW_QUERY_THRESHOLD_MS, by table. */
export const dbSlowQueryTotal = new Counter({
  name: 'db_slow_query_total',
  help: 'Total number of DB queries exceeding the slow query threshold',
  labelNames: ['table'],
});

function tableFromQuery(query: string): string {
  const match = /(?:from|into|update|table)\s+"?([a-z_][a-z0-9_]*)"?/i.exec(query);
  return match?.[1] ?? 'unknown';
}

/**
 * Development query profiler (#533). TypeORM calls logQuerySlow() for any
 * query exceeding `maxQueryExecutionTime` (DB_SLOW_QUERY_THRESHOLD_MS,
 * default 500ms). Logs the full query + params as WARN and bumps
 * db_slow_query_total{table}.
 */
export class SlowQueryLogger extends AdvancedConsoleLogger {
  private readonly logger = new Logger('SlowQuery');

  constructor(private readonly thresholdMs = 500) {
    super();
  }

  logQuerySlow(
    time: number,
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    const table = tableFromQuery(query);
    dbSlowQueryTotal.inc({ table });
    this.logger.warn(
      `Slow query detected (${time}ms > ${this.thresholdMs}ms) [table=${table}]: ${query} -- parameters: ${JSON.stringify(parameters ?? [])}`,
    );
  }
}
