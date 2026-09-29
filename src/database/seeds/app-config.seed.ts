import { Connection } from 'typeorm';
import { RuntimeConfig } from '../../runtime-config/entities/runtime-config.entity';

export async function seedAppConfigs(connection: Connection): Promise<void> {
  const repo = connection.getRepository(RuntimeConfig);

  const seeds = [
    {
      key: 'platform.name',
      value: 'Stellar Payment Gateway',
      description: 'Human readable platform name',
    },
    {
      key: 'platform.support_email',
      value: 'support@localhost',
      description: 'Support contact email',
    },
    {
      key: 'payments.default_network',
      value: 'stellar',
      description: 'Default payment network',
    },
    {
      key: 'payments.min_amount_usd',
      value: '1',
      description: 'Minimum accepted payment amount in USD',
    },
    {
      key: 'settlements.auto_approve',
      value: 'false',
      description: 'Whether settlements are auto-approved',
    },
  ];

  for (const seed of seeds) {
    const existing = await repo.findOne({ where: { key: seed.key } });
    if (existing) {
      const merged = repo.merge(existing, seed);
      merged.id = existing.id;
      await repo.save(merged);
    } else {
      await repo.save(repo.create(seed));
    }
  }

  console.log('App configs seeded.');
}
