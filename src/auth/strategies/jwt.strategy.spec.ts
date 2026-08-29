import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtStrategy } from './jwt.strategy';
import { CacheService } from '../../cache/cache.service';
import { Merchant } from '../../merchants/entities/merchant.entity';

const mockMerchantsRepo = {
  findOne: jest.fn(),
};

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('test-jwt-secret'),
};

const basePayload = () => ({
  sub: 'merchant-1',
  email: 'merchant@example.com',
  role: 'merchant',
  jti: 'session-1',
  exp: Math.floor(Date.now() / 1000) + 300,
});

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.set.mockResolvedValue(undefined);
    mockConfigService.get.mockReturnValue('test-jwt-secret');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(Merchant), useValue: mockMerchantsRepo },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('rejects a blacklisted (revoked) session before any lookup', async () => {
    mockCacheService.get.mockResolvedValueOnce(true); // blacklist hit

    await expect(strategy.validate(basePayload())).rejects.toThrow(UnauthorizedException);
    expect(mockCacheService.get).toHaveBeenCalledWith('session:blacklist:session-1');
    expect(mockMerchantsRepo.findOne).not.toHaveBeenCalled();
  });

  it('returns the cached session on a cache hit without touching the DB', async () => {
    const cached = { merchantId: 'merchant-1', email: 'merchant@example.com', role: 'merchant' };
    mockCacheService.get
      .mockResolvedValueOnce(false) // blacklist miss
      .mockResolvedValueOnce(cached); // session cache hit

    const result = await strategy.validate(basePayload());

    expect(result).toBe(cached);
    expect(mockCacheService.get).toHaveBeenNthCalledWith(2, 'session:session-1');
    expect(mockMerchantsRepo.findOne).not.toHaveBeenCalled();
    expect(mockCacheService.set).not.toHaveBeenCalled();
  });

  it('falls back to the merchant DB on a cache miss and caches the result', async () => {
    mockCacheService.get
      .mockResolvedValueOnce(false) // blacklist miss
      .mockResolvedValueOnce(null); // session cache miss
    mockMerchantsRepo.findOne.mockResolvedValueOnce({
      id: 'merchant-1',
      email: 'merchant@example.com',
      role: 'merchant',
    });

    const payload = basePayload();
    const result = await strategy.validate(payload);

    expect(mockMerchantsRepo.findOne).toHaveBeenCalledWith({ where: { id: 'merchant-1' } });
    expect(result).toEqual({
      merchantId: 'merchant-1',
      email: 'merchant@example.com',
      role: 'merchant',
    });
    expect(mockCacheService.set).toHaveBeenCalledWith(
      'session:session-1',
      result,
      { ttlSeconds: expect.any(Number) },
    );
  });

  it('throws when the merchant cannot be found in the DB', async () => {
    mockCacheService.get
      .mockResolvedValueOnce(false) // blacklist miss
      .mockResolvedValueOnce(null); // session cache miss
    mockMerchantsRepo.findOne.mockResolvedValueOnce(null);

    await expect(strategy.validate(basePayload())).rejects.toThrow('Merchant not found');
    expect(mockCacheService.set).not.toHaveBeenCalled();
  });

  it('does not write a cache entry for an already-expired token', async () => {
    mockCacheService.get
      .mockResolvedValueOnce(false) // blacklist miss
      .mockResolvedValueOnce(null); // session cache miss
    mockMerchantsRepo.findOne.mockResolvedValueOnce({
      id: 'merchant-1',
      email: 'merchant@example.com',
      role: 'merchant',
    });

    await strategy.validate({ ...basePayload(), exp: Math.floor(Date.now() / 1000) - 10 });

    expect(mockCacheService.set).not.toHaveBeenCalled();
  });

  it('uses payload.sub as the session id when jti is absent', async () => {
    mockCacheService.get
      .mockResolvedValueOnce(false) // blacklist miss
      .mockResolvedValueOnce(null); // session cache miss
    mockMerchantsRepo.findOne.mockResolvedValueOnce({
      id: 'merchant-1',
      email: 'merchant@example.com',
      role: 'merchant',
    });

    const { jti: _jti, ...payload } = basePayload();
    await strategy.validate(payload);

    expect(mockCacheService.get).toHaveBeenNthCalledWith(1, 'session:blacklist:merchant-1');
    expect(mockCacheService.get).toHaveBeenNthCalledWith(2, 'session:merchant-1');
  });
});
