import { validate } from 'class-validator';
import { ReviewFlagDto } from './aml.controller';
import { AmlFlagStatus } from './entities/aml-flag.entity';

describe('ReviewFlagDto validation', () => {
  it('accepts a valid AML flag status', async () => {
    const dto = Object.assign(new ReviewFlagDto(), {
      status: AmlFlagStatus.CLEARED,
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an unknown AML flag status', async () => {
    const dto = Object.assign(new ReviewFlagDto(), {
      status: 'invalid-status',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
