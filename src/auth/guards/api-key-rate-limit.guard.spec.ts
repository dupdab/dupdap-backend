import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ApiKeyRateLimitGuard } from './api-key-rate-limit.guard';
import { RateLimitService } from '../rate-limit.service';

describe('ApiKeyRateLimitGuard', () => {
  const rateLimitService = {
    checkApiKeyRateLimit: jest.fn(),
  };

  const guard = new ApiKeyRateLimitGuard(rateLimitService as unknown as RateLimitService);

  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((key: string, value: unknown) => {
      headers[key] = String(value);
    }),
  };

  const contextFor = (req: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(headers).forEach((k) => delete headers[k]);
  });

  it('skips rate limiting for non-API-key requests', async () => {
    const allowed = await guard.canActivate(
      contextFor({ user: { merchantId: 'm-1' }, headers: {} }),
    );
    expect(allowed).toBe(true);
    expect(rateLimitService.checkApiKeyRateLimit).not.toHaveBeenCalled();
  });

  it('skips when there is no merchantId even with an API key header', async () => {
    const allowed = await guard.canActivate(
      contextFor({ user: {}, headers: { 'x-api-key': 'key' } }),
    );
    expect(allowed).toBe(true);
    expect(rateLimitService.checkApiKeyRateLimit).not.toHaveBeenCalled();
  });

  it('allows a request under the API key rate limit and sets headers', async () => {
    rateLimitService.checkApiKeyRateLimit.mockResolvedValueOnce({
      allowed: true,
      limit: 1000,
      remaining: 999,
      resetAt: 1_700_000_000,
    });

    const allowed = await guard.canActivate(
      contextFor({
        user: { merchantId: 'm-1', role: 'merchant' },
        headers: { 'x-api-key': 'key' },
      }),
    );

    expect(allowed).toBe(true);
    expect(rateLimitService.checkApiKeyRateLimit).toHaveBeenCalledWith('m-1', 'merchant');
    expect(headers['X-RateLimit-Limit']).toBe('1000');
    expect(headers['X-RateLimit-Remaining']).toBe('999');
  });

  it('throws 429 when the API key rate limit is exceeded', async () => {
    rateLimitService.checkApiKeyRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 1000,
      remaining: 0,
      resetAt: 1_700_000_000,
      retryAfter: 42,
    });

    try {
      await guard.canActivate(
        contextFor({
          user: { merchantId: 'm-1', role: 'merchant' },
          headers: { 'x-api-key': 'key' },
        }),
      );
      fail('expected HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    expect(headers['Retry-After']).toBe('42');
  });
});
