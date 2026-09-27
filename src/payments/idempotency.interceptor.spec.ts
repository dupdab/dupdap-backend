import { of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { CacheService } from '../cache/cache.service';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let cacheService: Partial<CacheService>;

  const buildContext = (idempotencyKey?: string) => {
    const response = { statusCode: 201 };
    const request = { headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {} };
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

  it('passes ttlSeconds (not ttl) through to CacheService.set so the configured TTL actually applies', async () => {
    const context = buildContext('key-123');
    const next = { handle: () => of({ ok: true }) };

    const result$ = await interceptor.intercept(context, next as any);
    await new Promise((resolve) => result$.subscribe({ complete: resolve, next: resolve }));

    expect(cacheService.set).toHaveBeenCalledWith(
      'idempotency:payment:key-123',
      expect.objectContaining({ status: 201, body: { ok: true } }),
      { ttlSeconds: 86_400 },
    );
  });

  it('skips caching when no idempotency key is present', async () => {
    const context = buildContext();
    const next = { handle: jest.fn().mockReturnValue(of({ ok: true })) };

    await interceptor.intercept(context, next as any);

    expect(next.handle).toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalled();
  });
});
