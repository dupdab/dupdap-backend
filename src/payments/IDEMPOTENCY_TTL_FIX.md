# Idempotency interceptor TTL fix

## What was wrong

`src/payment/idempotency.interceptor.ts` called:

```ts
this.cacheService.set(cacheKey, { ... }, { ttl: IDEMPOTENCY_TTL });
```

but `CacheService.set()` (`src/cache/cache.service.ts`) has the signature
`set(key, value, options?: { ttlSeconds?: number })` and reads
`options?.ttlSeconds ?? 86400`. The `ttl` property the interceptor passed
was never read, so the call silently fell back to `CacheService`'s
hardcoded 86400s default.

This "worked" only because `IDEMPOTENCY_TTL` (86_400s) happened to equal
the fallback default. Changing `IDEMPOTENCY_TTL` independently would have
had no effect on the actual cache TTL, with no error or warning.

## What changed

- `src/payment/idempotency.interceptor.ts`: pass `{ ttlSeconds: IDEMPOTENCY_TTL }`
  instead of `{ ttl: IDEMPOTENCY_TTL }`.
- Added `src/payment/idempotency.interceptor.spec.ts` with a unit test that
  asserts `CacheService.set` is called with `{ ttlSeconds: 86_400 }`, so a
  future regression to the wrong option key fails the test instead of
  silently falling back to the default.
