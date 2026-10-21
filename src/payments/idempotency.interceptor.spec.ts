import { of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { CacheService } from '../cache/cache.service';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let cacheService: Partial<CacheService>;

  const buildContext = (requestId?: string) => {
    const response = { statusCode: 201 };
    const request = { method: 'POST', url: '/payments', body: {}, headers: requestId ? { 'x-request-id': requestId } : {} };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as any;
  };

  beforeEach(() => {
    cacheService = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    interceptor = new IdempotencyInterceptor(cacheService as CacheService);
  });

  it('stores a request response for five minutes under its request ID', async () => {
    const context = buildContext('key-123');
    const next = { handle: () => of({ ok: true }) };

    const result$ = await interceptor.intercept(context, next as any);
    await new Promise<void>((resolve) => result$.subscribe({ complete: () => resolve(), next: () => resolve() }));

    expect(cacheService.set).toHaveBeenCalledWith(
      'request-dedup:key-123',
      expect.objectContaining({ hash: expect.any(String), status: 201, body: { ok: true } }),
      { ttlSeconds: 300 },
    );
  });

  it('skips caching when no request ID is present', async () => {
    const context = buildContext();
    const next = { handle: jest.fn().mockReturnValue(of({ ok: true })) };

    await interceptor.intercept(context, next as any);

    expect(next.handle).toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalled();
  });
});
