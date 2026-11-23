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

async function snapshotSchema(connection: Connection): Promise<SchemaSnapshot> {
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

function diffSnapshots(before: SchemaSnapshot, after: SchemaSnapshot): string[] {
  const diffs: string[] = [];
  const beforeTables = new Set(before.tables);
  const afterTables = new Set(after.tables);
  for (const t of beforeTables) {
    if (!afterTables.has(t)) diffs.push(`table missing after round-trip: ${t}`);
  }
  for (const t of afterTables) {
    if (!beforeTables.has(t)) diffs.push(`unexpected table after round-trip: ${t}`);
  }
  const beforeCols = new Set(before.columns);
  const afterCols = new Set(after.columns);
  for (const c of beforeCols) {
    if (!afterCols.has(c)) diffs.push(`column missing after round-trip: ${c}`);
  }
  for (const c of afterCols) {
    if (!beforeCols.has(c)) diffs.push(`unexpected column after round-trip: ${c}`);
  }
  return diffs;
}

async function main(): Promise<void> {
  const connection = await buildConnection();

  try {
    // 1. Bring the database fully up to date.
    const applied = await connection.runMigrations();
    for (const m of applied) {
      // eslint-disable-next-line no-console
      console.log('Applied migration:', m.name);
    }
    if (applied.length === 0) {
      // eslint-disable-next-line no-console
      console.log('No pending migrations (database is up to date).');
    }

    // 2. Capture schema state after the latest migration.
    const before = await snapshotSchema(connection);

    // 3. Roll back the latest migration.
    await connection.undoLastMigration();
    // eslint-disable-next-line no-console
    console.log('Rolled back latest migration.');

    // 4. Re-run the migration.
    const reapplied = await connection.runMigrations();
    for (const m of reapplied) {
      // eslint-disable-next-line no-console
      console.log('Re-applied migration:', m.name);
    }

    // 5. Assert schema state is identical after the round-trip.
    const after = await snapshotSchema(connection);
    const diffs = diffSnapshots(before, after);
    if (diffs.length > 0) {
      // eslint-disable-next-line no-console
      console.error('Migration rollback round-trip changed schema state:');
      for (const d of diffs) {
        // eslint-disable-next-line no-console
        console.error('  -', d);
      }
      throw new Error('Migration rollback round-trip is not idempotent.');
    }

    // eslint-disable-next-line no-console
    console.log('Migration rollback round-trip verified: schema state is identical.');
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
