import { validateSync } from 'class-validator';
import { UpdateWebhookRetryConfigDto } from './update-webhook-retry-config.dto';

describe('UpdateWebhookRetryConfigDto', () => {
  const dto = (maxAttempts: number, retryDelays: number[]) =>
    Object.assign(new UpdateWebhookRetryConfigDto(), { maxAttempts, retryDelays });

  it('accepts retry policies within the configured limits', () => {
    expect(validateSync(dto(10, [0, 86_400_000]))).toHaveLength(0);
  });

  it('rejects more than 10 attempts', () => {
    expect(validateSync(dto(11, [1000])).length).toBeGreaterThan(0);
  });

  it('rejects retry delays longer than 24 hours', () => {
    expect(validateSync(dto(2, [86_400_001])).length).toBeGreaterThan(0);
  });
});
