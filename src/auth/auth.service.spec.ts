import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { Merchant, MerchantStatus } from '../merchants/entities/merchant.entity';
import { CacheService } from '../cache/cache.service';

jest.mock('bcrypt');

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
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockJwtService.sign.mockReturnValue('signed-jwt-token');
    mockCacheService.set.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(Merchant), useValue: mockMerchantsRepo },
        { provide: JwtService, useValue: mockJwtService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
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
      const saved = { id: 'm1', email: dto.email, role: 'merchant', ...created };
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
    });

    it('throws UnauthorizedException when the merchant does not exist', async () => {
      mockMerchantsRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.login(dto as any)).rejects.toThrow(UnauthorizedException);
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
  });

  describe('logout / isBlacklisted', () => {
    it('writes a blacklist cache entry with the given TTL on logout', async () => {
      await service.logout('session-1', 120);

      expect(mockCacheService.set).toHaveBeenCalledWith('session:blacklist:session-1', true, { ttlSeconds: 120 });
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
      const merchants = [
        { id: 'm1', apiKeyHash: 'hash-1' },
        { id: 'm2', apiKeyHash: 'hash-2' },
      ];
      mockMerchantsRepo.find.mockResolvedValueOnce(merchants);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const result = await service.findMerchantByApiKey('raw-key');

      expect(result).toBe(merchants[1]);
    });

    it('returns null when no merchant matches the raw key', async () => {
      const merchants = [{ id: 'm1', apiKeyHash: 'hash-1' }];
      mockMerchantsRepo.find.mockResolvedValueOnce(merchants);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      const result = await service.findMerchantByApiKey('raw-key');

      expect(result).toBeNull();
    });
  });
});
