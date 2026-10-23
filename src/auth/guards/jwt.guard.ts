import { ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from '../auth.service';
import { RateLimitService } from '../rate-limit.service';
import { ApiScope } from '../scopes';
import { AuditService } from '../../audit/audit.service';
import { Merchant, MerchantRole } from '../../merchants/entities/merchant.entity';
import { getClientIp, ipInCidr } from '../../security/ip-allowlist.guard';

/** Roles allowed to bypass a key's IP allowlist for support work (audit-logged). */
const IP_ALLOWLIST_BYPASS_ROLES: MerchantRole[] = [MerchantRole.ADMIN, MerchantRole.SUPERADMIN];

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimitService: RateLimitService,
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const rawKey = req.headers['x-api-key'];

    if (typeof rawKey === 'string' && rawKey.trim().length > 0) {
      const merchant = await this.authService.findMerchantByApiKey(rawKey.trim());
      if (!merchant) {
        throw new UnauthorizedException('Invalid API key');
      }

      // Check key expiry before allowing the request through
      if (merchant.apiKeyExpiresAt != null && merchant.apiKeyExpiresAt <= new Date()) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'API key has expired. Please generate a new key.',
          code: 'API_KEY_EXPIRED',
        });
      }

      await this.enforceApiKeyIpAllowlist(req, merchant);

      const scopes = merchant.apiKeyScopes ?? [];
      req.user = {
        merchantId: merchant.id,
        email: merchant.email,
        role: merchant.role,
        authType: 'apiKey' as const,
        scopes,
      };

      // Apply per-merchant sliding window rate limit
      const result = await this.rateLimitService.checkApiKeyRateLimit(
        merchant.id,
        merchant.role,
      );

      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetAt);

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter ?? 3600);
        res.status(429).json({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `API key rate limit exceeded. Limit: ${result.limit} requests/hour.`,
          retryAfter: result.retryAfter,
        });
        return false;
      }

      this.enforceApiKeyScopes(context, scopes);
      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }

  private async enforceApiKeyIpAllowlist(
    req: Request,
    merchant: Merchant,
  ): Promise<void> {
    const allowlist = merchant.apiKeyIpAllowlist ?? [];
    if (allowlist.length === 0) return;

    const clientIp = getClientIp(req);
    if (allowlist.some((cidr) => ipInCidr(clientIp, cidr))) return;

    if (!IP_ALLOWLIST_BYPASS_ROLES.includes(merchant.role)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Requests from this IP address are not allowed for this API key',
        code: 'IP_NOT_ALLOWED',
      });
    }

    await this.auditService.log({
      actor: merchant.id,
      action: 'API_KEY_IP_ALLOWLIST_BYPASSED',
      resource: `merchant:${merchant.id}`,
      after: { method: req.method, path: req.originalUrl },
      ip: clientIp,
    });
  }

  private enforceApiKeyScopes(context: ExecutionContext, scopes: ApiScope[]): void {
    const requiredScopes = this.reflector.getAllAndOverride<ApiScope[]>('scopes', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredScopes?.length) {
      return;
    }

    const missing = requiredScopes.filter((scope) => !scopes.includes(scope));
    if (missing.length) {
      throw new ForbiddenException('Insufficient API key scopes');
    }
  }
}
