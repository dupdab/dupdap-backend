import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MerchantsService } from './merchants.service';
import { Merchant } from './entities/merchant.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CacheService } from '../cache/cache.service';
import { ApiScope, API_KEY_SCOPES } from '../auth/scopes';

describe('MerchantsService - generateApiKey', () => {
  let service: MerchantsService;
  let merchantsRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let auditLogRepo: {
    save: jest.Mock;
  };
  let cache: {
    getOrSet: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(async () => {
    merchantsRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    auditLogRepo = {
      save: jest.fn(),
    };
    cache = {
      getOrSet: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantsService,
        { provide: getRepositoryToken(Merchant), useValue: merchantsRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditLogRepo },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<MerchantsService>(MerchantsService);
  });

  it('throws 400 BadRequestException listing invalid scope names and does not save', async () => {
    const invalidInput = ['payments:read', 'invalid:scope', 'admin:all'] as unknown as ApiScope[];

    await expect(service.generateApiKey('merchant-1', invalidInput)).rejects.toThrow(
      new BadRequestException('Invalid API key scopes: invalid:scope, admin:all'),
    );

    expect(merchantsRepo.findOne).not.toHaveBeenCalled();
    expect(merchantsRepo.save).not.toHaveBeenCalled();
  });

  it('deduplicates repeated invalid scope names in the 400 error message', async () => {
    const invalidInput = ['bogus:scope', 'bogus:scope'] as unknown as ApiScope[];

    await expect(service.generateApiKey('merchant-1', invalidInput)).rejects.toThrow(
      new BadRequestException('Invalid API key scopes: bogus:scope'),
    );

    expect(merchantsRepo.save).not.toHaveBeenCalled();
  });

  it('rejects merchant:manage scope on API keys with 400 BadRequestException', async () => {
    await expect(
      service.generateApiKey('merchant-1', ['merchant:manage']),
    ).rejects.toThrow(new BadRequestException('Invalid API key scopes: merchant:manage'));

    expect(merchantsRepo.save).not.toHaveBeenCalled();
  });

  it('generates and stores an API key when all provided scopes are valid', async () => {
    const merchant = { id: 'merchant-1' } as Merchant;
    merchantsRepo.findOne.mockResolvedValue(merchant);
    merchantsRepo.save.mockResolvedValue(merchant);

    const scopes: ApiScope[] = ['payments:read', 'settlements:read'];
    const result = await service.generateApiKey('merchant-1', scopes);

    expect(result.apiKey).toMatch(/^cpk_[a-f0-9]{64}$/);
    expect(result.expiresAt).toBeNull();
    expect(merchant.apiKeyScopes).toEqual(scopes);
    expect(merchantsRepo.save).toHaveBeenCalledWith(merchant);
  });

  it('defaults to API_KEY_SCOPES when scopes are omitted', async () => {
    const merchant = { id: 'merchant-1' } as Merchant;
    merchantsRepo.findOne.mockResolvedValue(merchant);
    merchantsRepo.save.mockResolvedValue(merchant);

    await service.generateApiKey('merchant-1');

    expect(merchant.apiKeyScopes).toEqual(API_KEY_SCOPES);
    expect(merchantsRepo.save).toHaveBeenCalledWith(merchant);
  });
});
