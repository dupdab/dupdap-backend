import { validateJwtSecretConfig } from './jwt-secret.validation';

describe('JWT secret config validation (#835)', () => {
  const validSecret = 'a'.repeat(32);

  it('accepts a secret of exactly 32 characters', () => {
    expect(() => validateJwtSecretConfig({ JWT_SECRET: validSecret })).not.toThrow();
  });

  it('accepts a longer secret', () => {
    expect(() =>
      validateJwtSecretConfig({ JWT_SECRET: 'x'.repeat(64) }),
    ).not.toThrow();
  });

  it('rejects a secret shorter than 32 characters with a clear error', () => {
    expect(() => validateJwtSecretConfig({ JWT_SECRET: 'too-short' })).toThrow(
      /JWT_SECRET must be at least 32 characters long/,
    );
  });

  it('rejects a missing secret', () => {
    expect(() => validateJwtSecretConfig({})).toThrow(/JWT_SECRET is required/);
  });

  it('rejects an empty secret', () => {
    expect(() => validateJwtSecretConfig({ JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
  });

  it('keeps unrelated environment variables untouched', () => {
    const result = validateJwtSecretConfig({
      JWT_SECRET: validSecret,
      NODE_ENV: 'production',
    });
    expect(result.NODE_ENV).toBe('production');
  });
});
