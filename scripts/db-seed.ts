import 'reflect-metadata';
import * as path from 'path';
import * as crypto from 'crypto';
import { createConnection } from 'typeorm';
import { seedDatabase } from '../src/database/seeds';

const ALLOWED_ENVS = ['development', 'test'];

function assertSafeEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV;
  const force = process.argv.includes('--force');

  if (ALLOWED_ENVS.includes(String(nodeEnv))) {
    return;
  }

  if (force) {
    console.warn(
      `[db-seed] WARNING: NODE_ENV is "${nodeEnv ?? 'undefined'}" but --force was passed. Seeding anyway.`,
    );
    return;
  }

  console.error(
    `[db-seed] Refusing to seed: NODE_ENV must be one of ${ALLOWED_ENVS.join(', ')} ` +
      `(got "${nodeEnv ?? 'undefined'}"). Pass --force to override.`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  assertSafeEnvironment();

  const password = process.env.DB_PASSWORD || process.env.DB_PASS || '';
  const database = process.env.NODE_ENV === 'test' ? process.env.DB_NAME_TEST || 'dupdub_test' : process.env.DB_NAME || 'dupdub';

  const connection = await createConnection({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(String(process.env.DB_PORT || '5432'), 10),
    username: process.env.DB_USER || 'postgres',
    password,
    database,
    entities: [path.join(__dirname, '..', 'src', '**', '*.entity{.ts,.js}')],
    migrations: [path.join(__dirname, '..', 'src', 'database', 'migrations', '*.{ts,js}')],
    migrationsTableName: 'typeorm_migrations',
  });

  await connection.runMigrations();

  const adminPassword = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
  await seedDatabase(connection, process.env.NODE_ENV === 'test', adminPassword);
  await connection.close();

  console.log('[db-seed] Seeded admin@localhost with password:');
  console.log(`[db-seed]   ${adminPassword}`);
  console.log('[db-seed] Store this now — it will not be shown again.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
