jest.mock('@nestjs/core', () => ({
  Reflector: class Reflector {},
}));

jest.mock('@nestjs/passport', () => ({
  AuthGuard: () =>
    class {
      canActivate() {
        return Promise.resolve(true);
      }
    },
}));

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt.guard';
import { AuthService } from '../auth.service';
import { RateLimitService } from '../rate-limit.service';
import { MerchantRole } from '../../merchants/entities/merchant.entity';

describe('JwtAuthGuard', () => {
  const authService = {
    findMerchantByApiKey: jest.fn(),
  };
  const rateLimitService = {
    checkApiKeyRateLimit: jest.fn(),
  };
  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  let guard: JwtAuthGuard;

  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((key: string, value: unknown) => {
      headers[key] = String(value);
    }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  const makeContext = (req: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(headers).forEach((k) => delete headers[k]);
    res.status.mockReturnThis();
    guard = new JwtAuthGuard(
      authService as unknown as AuthService,
      rateLimitService as unknown as RateLimitService,
      reflector as unknown as Reflector,
    );
  });

  describe('API key path', () => {
    it('authenticates a valid API key and populates request.user', async () => {
      const req: Record<string, any> = { headers: { 'x-api-key': ' raw-key ' } };
      authService.findMerchantByApiKey.mockResolvedValueOnce({
        id: 'm-1',
        email: 'm@example.com',
        role: MerchantRole.MERCHANT,
        apiKeyScopes: ['payments:read'],
      });
      rateLimitService.checkApiKeyRateLimit.mockResolvedValueOnce({
        allowed: true,
        limit: 1000,
        remaining: 999,
        resetAt: 1_700_000_000,
      });
      reflector.getAllAndOverride.mockReturnValueOnce(undefined);

      await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
      expect(authService.findMerchantByApiKey).toHaveBeenCalledWith('raw-key');
      expect(req.user).toEqual({
        merchantId: 'm-1',
        email: 'm@example.com',
        role: MerchantRole.MERCHANT,
        authType: 'apiKey',
        scopes: ['payments:read'],
      });
    });

    it('rejects an invalid API key', async () => {
      authService.findMerchantByApiKey.mockResolvedValueOnce(null);

      await expect(
        guard.canActivate(makeContext({ headers: { 'x-api-key': 'bad' } })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns false and writes a 429 body when the rate limit is exceeded', async () => {
      authService.findMerchantByApiKey.mockResolvedValueOnce({
        id: 'm-1',
        email: 'm@example.com',
        role: MerchantRole.MERCHANT,
        apiKeyScopes: [],
      });
      rateLimitService.checkApiKeyRateLimit.mockResolvedValueOnce({
        allowed: false,
        limit: 1000,
        remaining: 0,
        resetAt: 1_700_000_000,
        retryAfter: 30,
      });

      const allowed = await guard.canActivate(makeContext({ headers: { 'x-api-key': 'key' } }));

      expect(allowed).toBe(false);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 429, retryAfter: 30 }),
      );
      expect(headers['Retry-After']).toBe('30');
    });

    it('enforces required API key scopes', async () => {
      authService.findMerchantByApiKey.mockResolvedValueOnce({
        id: 'm-1',
        email: 'm@example.com',
        role: MerchantRole.MERCHANT,
        apiKeyScopes: ['payments:read'],
      });
      rateLimitService.checkApiKeyRateLimit.mockResolvedValueOnce({
        allowed: true,
        limit: 1000,
        remaining: 999,
        resetAt: 1_700_000_000,
      });
      reflector.getAllAndOverride.mockReturnValueOnce(['payments:write']);

      await expect(
        guard.canActivate(makeContext({ headers: { 'x-api-key': 'key' } })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows when all required scopes are present', async () => {
      authService.findMerchantByApiKey.mockResolvedValueOnce({
        id: 'm-1',
        email: 'm@example.com',
        role: MerchantRole.MERCHANT,
        apiKeyScopes: ['payments:read', 'payments:write'],
      });
      rateLimitService.checkApiKeyRateLimit.mockResolvedValueOnce({
        allowed: true,
        limit: 1000,
        remaining: 999,
        resetAt: 1_700_000_000,
      });
      reflector.getAllAndOverride.mockReturnValueOnce(['payments:read']);

      await expect(
        guard.canActivate(makeContext({ headers: { 'x-api-key': 'key' } })),
      ).resolves.toBe(true);
    });
  });

  describe('JWT path', () => {
    it('delegates to AuthGuard when no API key header is present', async () => {
      await expect(guard.canActivate(makeContext({ headers: {} }))).resolves.toBe(true);
      expect(authService.findMerchantByApiKey).not.toHaveBeenCalled();
    });
  });
});
