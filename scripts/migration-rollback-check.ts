import 'reflect-metadata';
import * as path from 'path';
import { createConnection } from 'typeorm';

async function main(): Promise<void> {
  const password = process.env.DB_PASSWORD || process.env.DB_PASS || '';
  const connection = await createConnection({
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

  // eslint-disable-next-line no-console
  console.log(`Reverted ${reverted} migration(s); rollback check passed.`);

  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
