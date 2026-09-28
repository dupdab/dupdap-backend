import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JoinWaitlistDto } from './join-waitlist.dto';

describe('JoinWaitlistDto', () => {
  it('trims and lowercases the email so case variants cannot bypass uniqueness', () => {
    const dto = plainToInstance(JoinWaitlistDto, {
      email: '  Founder@Example.COM  ',
    });

    expect(dto.email).toBe('founder@example.com');
  });

  it('accepts a valid normalized payload', async () => {
    const dto = plainToInstance(JoinWaitlistDto, {
      email: 'founder@example.com',
      username: '  acme_corp  ',
      businessName: 'Acme Corp',
      country: 'NG',
    });

    expect(dto.username).toBe('acme_corp');
    expect(await validate(dto)).toHaveLength(0);
  });
});
