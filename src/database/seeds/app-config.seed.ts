import { Logger } from '@nestjs/common';
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
    {
      key: 'settlements.small_batch_threshold_usd',
      value: 10,
      description: 'Payments below this USD amount wait for the batch window',
    },
    {
      key: 'settlements.batch_fee_rate',
      value: 0.015,
      description: 'Fee rate applied to batched settlements',
    },
    {
      key: 'settlements.batch_window_minutes',
      value: 15,
      description: 'Batch window length in minutes',
    },
    {
      key: 'settlements.large_settlement_threshold',
      value: 10000,
      description: 'Net USD amount at or above which a settlement requires approval',
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

  new Logger('AppConfigSeed').log('App configs seeded.');
}
