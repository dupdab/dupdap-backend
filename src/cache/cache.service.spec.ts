import { CacheService, CACHE_INVALIDATION_CHANNEL } from './cache.service';

function makeMockRedis() {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    scan: jest.fn(),
    publish: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue(undefined),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    zcard: jest.fn().mockResolvedValue(0),
    zrange: jest.fn().mockResolvedValue([]),
    zadd: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };
}

describe('CacheService', () => {
  let service: CacheService;
  let redis: ReturnType<typeof makeMockRedis>;
  let subscriber: ReturnType<typeof makeMockRedis>;

  beforeEach(async () => {
    redis = makeMockRedis();
    subscriber = makeMockRedis();
    service = new CacheService(undefined, redis as any, subscriber as any);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  const env = process.env.NODE_ENV ?? 'development';
  const ns = `${env}:cache:`;

  describe('key namespacing', () => {
    it('prefixes get with {env}:cache:', async () => {
      redis.get.mockResolvedValue(null);
      await service.get('mykey');
      expect(redis.get).toHaveBeenCalledWith(`${ns}mykey`);
    });

    it('prefixes set with {env}:cache:', async () => {
      redis.set.mockResolvedValue('OK');
      await service.set('mykey', 42, { ttlSeconds: 10 });
      expect(redis.set).toHaveBeenCalledWith(`${ns}mykey`, expect.any(String), 'EX', 10);
    });

    it('ns property matches NODE_ENV', () => {
      expect(service.ns).toBe(`${env}:cache:`);
    });
  });

  describe('del', () => {
    it('deletes namespaced key and publishes bare key to invalidation channel', async () => {
      redis.del.mockResolvedValue(1);
      redis.publish.mockResolvedValue(1);
      await service.del('somekey');
      expect(redis.del).toHaveBeenCalledWith(`${ns}somekey`);
      expect(redis.publish).toHaveBeenCalledWith(CACHE_INVALIDATION_CHANNEL, 'somekey');
    });
  });

  describe('delPattern', () => {
    it('scans with namespaced pattern, deletes, and broadcasts stripped keys', async () => {
      redis.scan.mockResolvedValueOnce(['0', [`${ns}analytics:m1`, `${ns}analytics:m2`]]);
      redis.del.mockResolvedValue(2);
      redis.publish.mockResolvedValue(1);

      const count = await service.delPattern('analytics:*');

      expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', `${ns}analytics:*`, 'COUNT', 250);
      expect(redis.del).toHaveBeenCalledWith(`${ns}analytics:m1`, `${ns}analytics:m2`);
      expect(redis.publish).toHaveBeenCalledWith(
        CACHE_INVALIDATION_CHANNEL,
        JSON.stringify(['analytics:m1', 'analytics:m2']),
      );
      expect(count).toBe(2);
    });

    it('does not publish when no keys matched', async () => {
      redis.scan.mockResolvedValueOnce(['0', []]);
      await service.delPattern('nothing:*');
      expect(redis.publish).not.toHaveBeenCalled();
    });
  });

  describe('getOrSet', () => {
    it('returns cached value on hit without calling fetchFn', async () => {
      const encoded = JSON.stringify({ v: 1, encoding: 'json', payload: JSON.stringify(99) });
      redis.get.mockResolvedValue(encoded);
      const fetchFn = jest.fn();
      const result = await service.getOrSet('k', fetchFn, { ttlSeconds: 30 });
      expect(result).toEqual({ value: 99, cacheHit: true });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('calls fetchFn and stores result on miss', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockResolvedValue('OK');
      const fetchFn = jest.fn().mockResolvedValue('fresh');
      const result = await service.getOrSet('k', fetchFn, { ttlSeconds: 30 });
      expect(result).toEqual({ value: 'fresh', cacheHit: false });
      expect(redis.set).toHaveBeenCalledWith(`${ns}k`, expect.any(String), 'EX', 30);
    });
  });

  describe('pub/sub', () => {
    it('subscribes to invalidation channel on init', () => {
      expect(subscriber.subscribe).toHaveBeenCalledWith(CACHE_INVALIDATION_CHANNEL);
    });

    it('registers a message handler on the subscriber', () => {
      expect(subscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  describe('checkSlidingWindowRateLimit', () => {
    it('allows a request under the limit and records it in Redis', async () => {
      redis.zcard.mockResolvedValue(2);

      const result = await service.checkSlidingWindowRateLimit('ratelimit:apikey:m1', {
        limit: 10,
        windowSeconds: 3600,
      });

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(7);
      expect(redis.zremrangebyscore).toHaveBeenCalledWith(`${ns}ratelimit:apikey:m1`, '-inf', expect.any(Number));
      expect(redis.zadd).toHaveBeenCalled();
      expect(redis.expire).toHaveBeenCalledWith(`${ns}ratelimit:apikey:m1`, 3600);
    });

    it('denies when the window is full and reports retryAfter', async () => {
      const now = Math.floor(Date.now() / 1000);
      redis.zcard.mockResolvedValue(3);
      redis.zrange.mockResolvedValue(['old', String(now - 100)]);

      const result = await service.checkSlidingWindowRateLimit('ratelimit:apikey:m1', {
        limit: 3,
        windowSeconds: 3600,
      });

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetAt).toBe(now - 100 + 3600);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(redis.zadd).not.toHaveBeenCalled();
    });

    it('falls back to in-memory when Redis throws', async () => {
      redis.zremrangebyscore.mockRejectedValue(new Error('redis down'));

      const first = await service.checkSlidingWindowRateLimit('ratelimit:apikey:m2', {
        limit: 2,
        windowSeconds: 3600,
      });
      const second = await service.checkSlidingWindowRateLimit('ratelimit:apikey:m2', {
        limit: 2,
        windowSeconds: 3600,
      });
      const third = await service.checkSlidingWindowRateLimit('ratelimit:apikey:m2', {
        limit: 2,
        windowSeconds: 3600,
      });

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect(third.allowed).toBe(false);
      expect(third.remaining).toBe(0);
    });
  });
});
