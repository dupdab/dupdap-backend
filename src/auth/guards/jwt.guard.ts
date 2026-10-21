import { Optional } from '@nestjs/common';
import { TeamService, memberScopes } from '../../merchants/team.service';
import { ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { RateLimitService } from '../rate-limit.service';
import { ApiScope } from '../scopes';
import { getCorrelationId } from '../../common/correlation-id.context';
import { randomUUID } from 'crypto';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimitService: RateLimitService,
    private readonly reflector: Reflector,
    @Optional() private readonly team?: TeamService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const rawKey = req.headers['x-api-key'];

    if (typeof rawKey === 'string' && rawKey.trim().length > 0) {
      const member = await this.team?.authenticate(rawKey.trim());
      if (member) {
        req.user = member;
        this.enforceMemberAccess(context, member.memberRole);
        this.enforceApiKeyScopes(context, member.scopes);
        return this.applyRateLimit(req, res);
      }
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

      const scopes = merchant.apiKeyScopes ?? [];
      req.user = {
        merchantId: merchant.id,
        email: merchant.email,
        role: merchant.role,
        authType: 'apiKey' as const,
        scopes,
      };

      if (!(await this.applyRateLimit(req, res))) return false;

      this.enforceApiKeyScopes(context, scopes);
      return true;
    }

    const authenticated = (await super.canActivate(context)) as boolean;
    const selected = req.headers['x-merchant-id'];
    if (authenticated && selected && this.team) {
      req.user = await this.team.context(req.user, String(selected));
      if (req.user.memberId && req.user.memberRole !== 'OWNER') {
        const scopes = memberScopes(req.user.memberRole);
        this.enforceMemberAccess(context, req.user.memberRole);
        this.enforceApiKeyScopes(context, scopes);

      }
    }
    return authenticated;
  }

  private async applyRateLimit(req: any, res: any): Promise<boolean> {
    const result = await this.rateLimitService.checkApiKeyRateLimit(req.user.merchantId, req.user.role);
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetAt);
    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfter ?? 3600);
      const requestId = getCorrelationId() ?? randomUUID();
      res.setHeader('X-Request-ID', requestId);
      res.status(429).json({ statusCode: 429, error: 'Too Many Requests',
        message: `API key rate limit exceeded. Limit: ${result.limit} requests/hour.`, requestId });
      return false;
    }
    return true;
  }

  private enforceMemberAccess(context: ExecutionContext, role: string): void {
    const req = context.switchToHttp().getRequest();
    if (req.user.authType !== 'apiKey' && this.reflector.get<boolean>('memberKeyCreation', context.getHandler())) return;
    if (role === 'OWNER') return;
    const required = this.reflector.getAllAndOverride<ApiScope[]>('scopes', [context.getHandler(), context.getClass()]);
    if ((!required?.length && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) ||
        (role === 'VIEWER' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)))
      throw new ForbiddenException('Insufficient member permissions');
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
