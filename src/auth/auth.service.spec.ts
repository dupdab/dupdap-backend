import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { instanceToPlain } from 'class-transformer';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { Merchant, MerchantStatus } from '../merchants/entities/merchant.entity';
import { CacheService } from '../cache/cache.service';

jest.mock('bcrypt');
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
  getRepositoryToken: (entity: unknown) => entity,
}));

describe('AuthService', () => {
  let service: AuthService;

  const mockMerchantsRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('signed-jwt-token'),
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockJwtService.sign.mockReturnValue('signed-jwt-token');
    mockCacheService.set.mockResolvedValue(undefined);
    mockCacheService.del.mockResolvedValue(undefined);
    mockCacheService.get.mockResolvedValue(undefined);

    service = new AuthService(
      mockMerchantsRepo as any,
      mockJwtService as unknown as JwtService,
      mockCacheService as unknown as CacheService,
    );
  });

  describe('register', () => {
    const dto = {
      email: 'merchant@example.com',
      password: 'SecurePass123!',
      businessName: 'Acme Corp',
    };

    it('hashes the password, creates the merchant, and returns an access token', async () => {
      mockMerchantsRepo.findOne.mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-password');
      const created = { email: dto.email, businessName: dto.businessName, passwordHash: 'hashed-password' };
      mockMerchantsRepo.create.mockReturnValueOnce(created);
      const saved = Object.assign(new Merchant(), {
        id: 'm1',
        role: 'merchant',
        ...created,
      });
      mockMerchantsRepo.save.mockResolvedValueOnce(saved);

      const result = await service.register(dto as any);

      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 12);
      expect(mockMerchantsRepo.save).toHaveBeenCalledWith(created);
      expect(result).toEqual({ accessToken: 'signed-jwt-token', merchant: saved });
    });

    it('throws ConflictException when the email is already registered', async () => {
      mockMerchantsRepo.findOne.mockResolvedValueOnce({ id: 'existing', email: dto.email });

      await expect(service.register(dto as any)).rejects.toThrow(ConflictException);
      expect(mockMerchantsRepo.save).not.toHaveBeenCalled();
    });

    it('strips totpSecret and passwordHash when the register merchant is serialized', async () => {
      mockMerchantsRepo.findOne.mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-password');
      const created = { email: dto.email, businessName: dto.businessName, passwordHash: 'hashed-password' };
      mockMerchantsRepo.create.mockReturnValueOnce(created);
      const saved = Object.assign(new Merchant(), {
        id: 'm1',
        email: dto.email,
        role: 'merchant',
        passwordHash: 'hashed-password',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        totpEnabled: true,
      });
      mockMerchantsRepo.save.mockResolvedValueOnce(saved);

      const result = await service.register(dto as any);
      const serialized = instanceToPlain(result.merchant);

      expect(serialized).not.toHaveProperty('totpSecret');
      expect(serialized).not.toHaveProperty('passwordHash');
      expect(serialized).not.toHaveProperty('apiKeyHash');
    });
  });

  describe('login', () => {
    const dto = { email: 'merchant@example.com', password: 'SecurePass123!' };

    it('returns an access token for valid credentials', async () => {
      const merchant = {
        id: 'm1',
        email: dto.email,
        role: 'merchant',
        passwordHash: 'hashed-password',
        status: MerchantStatus.ACTIVE,
      };
      mockMerchantsRepo.findOne.mockResolvedValueOnce(merchant);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await service.login(dto as any);

      expect(bcrypt.compare).toHaveBeenCalledWith(dto.password, merchant.passwordHash);
      expect(result).toEqual({ accessToken: 'signed-jwt-token', merchant });
      expect(mockCacheService.del).toHaveBeenCalledWith('auth:failed:merchant@example.com');
    });

    it('strips totpSecret from the login merchant when ClassSerializerInterceptor serializes it', async () => {
      const merchant = Object.assign(new Merchant(), {
        id: 'm1',
        email: dto.email,
        role: 'merchant',
        passwordHash: 'hashed-password',
        status: MerchantStatus.ACTIVE,
        totpSecret: 'JBSWY3DPEHPK3PXP',
        totpEnabled: true,
        apiKeyHash: 'api-hash',
      });
      mockMerchantsRepo.findOne.mockResolvedValueOnce(merchant);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await service.login(dto as any);
      const serialized = instanceToPlain(result.merchant);

      expect(serialized).not.toHaveProperty('totpSecret');
      expect(serialized).not.toHaveProperty('passwordHash');
      expect(serialized).not.toHaveProperty('apiKeyHash');
      expect(serialized.email).toBe(dto.email);
      expect(serialized.totpEnabled).toBe(true);
    });

    it('throws UnauthorizedException when the merchant does not exist', async () => {
      mockMerchantsRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.login(dto as any)).rejects.toThrow(UnauthorizedException);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'auth:failed:merchant@example.com',
        1,
        { ttlSeconds: 15 * 60 },
      );
    });

    it('throws UnauthorizedException when the password does not match', async () => {
      mockMerchantsRepo.findOne.mockResolvedValueOnce({
        id: 'm1',
        email: dto.email,
        passwordHash: 'hashed-password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.login(dto as any)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects login while the account is locked out', async () => {
      mockCacheService.get.mockResolvedValueOnce(true);

      await expect(service.login(dto as any)).rejects.toThrow(/temporarily locked/i);
      expect(mockMerchantsRepo.findOne).not.toHaveBeenCalled();
    });

    it('locks the account after 5 failed password attempts', async () => {
      mockMerchantsRepo.findOne.mockResolvedValue({
        id: 'm1',
        email: dto.email,
        passwordHash: 'hashed-password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      mockCacheService.get
        .mockResolvedValueOnce(undefined) // not locked
        .mockResolvedValueOnce(4); // already 4 failures

      await expect(service.login(dto as any)).rejects.toThrow(UnauthorizedException);

      expect(mockCacheService.set).toHaveBeenCalledWith(
        'auth:lockout:merchant@example.com',
        true,
        { ttlSeconds: 15 * 60 },
      );
      expect(mockCacheService.del).toHaveBeenCalledWith('auth:failed:merchant@example.com');
    });
  });

  describe('logout / isBlacklisted', () => {
    it('writes a blacklist cache entry with the given TTL on logout', async () => {
      await service.logout('session-1', 120);

      expect(mockCacheService.set).toHaveBeenCalledWith('session:blacklist:session-1', true, {
        ttlSeconds: 120,
      });
    });

    it('reports blacklisted when the cache entry is true', async () => {
      mockCacheService.get.mockResolvedValueOnce(true);

      await expect(service.isBlacklisted('session-1')).resolves.toBe(true);
      expect(mockCacheService.get).toHaveBeenCalledWith('session:blacklist:session-1');
    });

    it('reports not blacklisted when there is no cache entry', async () => {
      mockCacheService.get.mockResolvedValueOnce(null);

      await expect(service.isBlacklisted('session-1')).resolves.toBe(false);
    });
  });

  describe('findMerchantByApiKey', () => {
    it('returns the merchant whose api key hash matches', async () => {
      const merchant = { id: 'm1', apiKeyHash: 'hash-1', apiKeyLookupHash: 'lookup' };
      mockMerchantsRepo.findOne.mockResolvedValueOnce(merchant);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await service.findMerchantByApiKey('raw-key');

      expect(result).toBe(merchant);
    });

    it('returns null when no merchant matches the raw key', async () => {
      mockMerchantsRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.findMerchantByApiKey('raw-key');

      expect(result).toBeNull();
    });
  });
});
