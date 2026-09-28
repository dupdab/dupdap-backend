import { instanceToPlain } from 'class-transformer';
import { Merchant } from '../merchants/entities/merchant.entity';

/**
 * Regression coverage for #295 / #296: secrets must be stripped and
 * bankAccountNumber masked when ClassSerializerInterceptor / instanceToPlain runs.
 * AdminService.sanitize now delegates to instanceToPlain on a Merchant instance.
 */
describe('Merchant serialization', () => {
  it('excludes totpSecret, passwordHash, and apiKeyHash', () => {
    const merchant = Object.assign(new Merchant(), {
      id: 'm-1',
      email: 'admin@example.com',
      passwordHash: 'hashed-password',
      apiKeyHash: 'hashed-api-key',
      apiKeyLookupHash: 'lookup-hash',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      totpEnabled: true,
      allowedIps: '1.2.3.4',
      bankAccountNumber: '1234567890',
    });

    const plain = instanceToPlain(merchant);

    expect(plain).not.toHaveProperty('totpSecret');
    expect(plain).not.toHaveProperty('passwordHash');
    expect(plain).not.toHaveProperty('apiKeyHash');
    expect(plain).not.toHaveProperty('apiKeyLookupHash');
    expect(plain.totpEnabled).toBe(true);
    expect(plain.allowedIps).toBe('1.2.3.4');
    expect(plain.bankAccountNumber).toBe('****7890');
  });
});
