import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RateLimitService } from '../rate-limit.service';

/**
 * Rate-limits API-key authenticated merchant requests.
 *
 * Non-API-key requests (e.g. bearer JWT sessions) and requests without a
 * resolved merchantId are skipped. State is backed by Redis via
 * RateLimitService (CacheService sliding window), not in-memory. On 429
 * responses a `Retry-After` header is returned.
 */
@Injectable()
export class ApiKeyRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: { merchantId?: string; role?: string } }>();
    const res = context.switchToHttp().getResponse();

    // Only rate-limit API-key authenticated merchant requests.
    if (!req.headers['x-api-key']) return true;
    const merchantId = req.user?.merchantId;
    if (!merchantId) return true;

    const role = req.user?.role ?? 'merchant';
    const result = await this.rateLimit.checkApiKeyRateLimit(merchantId, role);

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfter ?? 0));
      throw new HttpException('API key rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}
