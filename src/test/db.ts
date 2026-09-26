import { DataSource } from 'typeorm';
import * as path from 'path';

// Load every entity in the application (same glob ormconfig.ts uses) so that
// synchronize creates all tables needed by integration specs.
export const TEST_ENTITIES = [
  path.join(__dirname, '..', '**', '*.entity{.ts,.js}'),
];

export async function createTestDataSource(): Promise<DataSource> {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME_TEST ?? 'dupdub_test',
    entities: TEST_ENTITIES,
    synchronize: true,
    logging: false,
  });
  await ds.initialize();
  return ds;
}

export async function truncateAll(dataSource: DataSource): Promise<void> {
  const tableNames = dataSource.entityMetadatas
    .map((m) => m.tableName)
    .join('", "');
  await dataSource.query(`TRUNCATE TABLE "${tableNames}" RESTART IDENTITY CASCADE`);
}

export async function closeTestDataSource(dataSource: DataSource): Promise<void> {
  if (dataSource.isInitialized) await dataSource.destroy();
}
