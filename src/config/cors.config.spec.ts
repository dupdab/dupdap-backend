import { isOriginAllowed, parseAllowedOrigins, validateCorsConfig } from './cors.config';

describe('CORS configuration (#542)', () => {
  it('allows a configured origin', () => {
    const allowed = parseAllowedOrigins('https://app.dupdub.xyz,https://dupdub.xyz');
    expect(isOriginAllowed('https://app.dupdub.xyz', allowed)).toBe(true);
  });

  it('blocks an unlisted origin', () => {
    const allowed = parseAllowedOrigins('https://app.dupdub.xyz');
    expect(isOriginAllowed('https://evil.example.com', allowed)).toBe(false);
  });

  it('rejects wildcard in production', () => {
    expect(() => validateCorsConfig('production', ['*'])).toThrow();
    expect(() => validateCorsConfig('production', [])).toThrow();
    expect(() =>
      validateCorsConfig('production', ['https://app.dupdub.xyz']),
    ).not.toThrow();
  });
});
