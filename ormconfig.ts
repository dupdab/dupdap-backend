import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isDevelopment = nodeEnv === 'development';

// Hard-disable synchronize outside development. In dev it may be enabled via env.
const synchronize = isDevelopment
  ? process.env.DB_SYNCHRONIZE === 'true'
  : false;

// Startup assertion: never allow synchronize in production.
if (isProduction && synchronize) {
  // eslint-disable-next-line no-console
  console.error(
    '[ormconfig] FATAL: TypeORM synchronize must be false in production. Refusing to start.',
  );
  process.exit(1);
}

// Connection pool tuning. Defaults are raised above TypeORM's default of 10
// so moderate load does not saturate the pool. Override via DB_POOL_MIN/MAX.
const poolMax = parseInt(process.env.DB_POOL_MAX || '20', 10);
const poolMin = parseInt(process.env.DB_POOL_MIN || '2', 10);

if (Number.isNaN(poolMax) || poolMax < 1) {
  // eslint-disable-next-line no-console
  console.error(
    `[ormconfig] FATAL: DB_POOL_MAX must be a positive integer (got "${process.env.DB_POOL_MAX}").`,
  );
  process.exit(1);
}

if (Number.isNaN(poolMin) || poolMin < 0 || poolMin > poolMax) {
  // eslint-disable-next-line no-console
  console.error(
    `[ormconfig] FATAL: DB_POOL_MIN must be between 0 and DB_POOL_MAX (${poolMax}) (got "${process.env.DB_POOL_MIN}").`,
  );
  process.exit(1);
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'dupdub',
  entities: [path.join(__dirname, 'src/**/*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, 'src/database/migrations/*{.ts,.js}')],
  migrationsTableName: 'typeorm_migrations',
  synchronize,
  extra: {
    max: poolMax,
    min: poolMin,
    connectionTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT_MS || '10000', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '60000', 10),
  },
});

export default AppDataSource;
