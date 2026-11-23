import 'reflect-metadata';
import * as path from 'path';
import { createConnection, Connection } from 'typeorm';

function buildConnection(): Promise<Connection> {
  const password = process.env.DB_PASSWORD || process.env.DB_PASS || '';
  return createConnection({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(String(process.env.DB_PORT || '5432'), 10),
    username: process.env.DB_USER || 'postgres',
    password,
    database: process.env.DB_NAME || 'dupdub',
    entities: [],
    migrations: [path.join(__dirname, '..', 'src', 'database', 'migrations', '*.{ts,js}')],
    migrationsTableName: 'typeorm_migrations',
  });
}

interface SchemaSnapshot {
  tables: string[];
  columns: string[];
}

async function captureSchema(connection: Connection): Promise<SchemaSnapshot> {
  const tables: Array<{ table_name: string }> = await connection.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const columns: Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }> =
    await connection.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, column_name`,
    );

  return {
    tables: tables.map((t) => t.table_name),
    columns: columns.map(
      (c) => `${c.table_name}.${c.column_name}:${c.data_type}:${c.is_nullable}`,
    ),
  };
}

function assertSchemaIdentical(before: SchemaSnapshot, after: SchemaSnapshot): void {
  const beforeTables = JSON.stringify(before.tables);
  const afterTables = JSON.stringify(after.tables);
  const beforeColumns = JSON.stringify(before.columns);
  const afterColumns = JSON.stringify(after.columns);

  if (beforeTables !== afterTables || beforeColumns !== afterColumns) {
    // eslint-disable-next-line no-console
    console.error('Schema mismatch detected after rollback round-trip.');
    // eslint-disable-next-line no-console
    console.error('Tables before:', beforeTables);
    // eslint-disable-next-line no-console
    console.error('Tables after: ', afterTables);
    // eslint-disable-next-line no-console
    console.error('Columns before:', beforeColumns);
    // eslint-disable-next-line no-console
    console.error('Columns after: ', afterColumns);
    throw new Error('Rollback did not restore the original schema state.');
  }
}

async function main(): Promise<void> {
  const connection = await buildConnection();

  try {
    const baseline = await captureSchema(connection);

    const applied = await connection.runMigrations();
    for (const m of applied) {
      // eslint-disable-next-line no-console
      console.log('Applied migration:', m.name);
    }

    // Only revert the migrations applied during this check, never pre-existing ones.
    let reverted = 0;
    for (let i = 0; i < applied.length; i += 1) {
      await connection.undoLastMigration();
      reverted += 1;
    }

    const afterRollback = await captureSchema(connection);
    assertSchemaIdentical(baseline, afterRollback);
    // eslint-disable-next-line no-console
    console.log(`Reverted ${reverted} migration(s); schema restored to baseline.`);

    // Re-run the migrations to confirm they apply cleanly after a rollback.
    const reapplied = await connection.runMigrations();
    for (const m of reapplied) {
      // eslint-disable-next-line no-console
      console.log('Re-applied migration:', m.name);
    }

    // eslint-disable-next-line no-console
    console.log('Rollback round-trip check passed.');
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
