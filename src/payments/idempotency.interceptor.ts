import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import * as crypto from 'crypto';
import { ConflictException } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

const IDEMPOTENCY_TTL = 300;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly cacheService: CacheService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    if (request.method !== 'POST') return next.handle();
    const requestId = request.headers['x-request-id'];

    if (!requestId || typeof requestId !== 'string' || requestId.length > 200) return next.handle();

    const requestHash = crypto.createHash('sha256').update(JSON.stringify({
      method: request.method,
      path: request.originalUrl ?? request.url,
      merchantId: request.user?.merchantId ?? request.user?.id ?? null,
      body: request.body,
    })).digest('hex');
    const cacheKey = `request-dedup:${requestId}`;
    const cached = await this.cacheService.get<{ hash: string; status: number; body: any }>(cacheKey);

    if (cached) {
      if (cached.hash !== requestHash) throw new ConflictException('X-Request-ID was already used for a different request');
      const response = context.switchToHttp().getResponse();
      response.status(cached.status);
      return of(cached.body);
    }

    return next.handle().pipe(
      mergeMap(async (body) => {
        const response = context.switchToHttp().getResponse();
        await this.cacheService.set(cacheKey, {
          hash: requestHash,
          status: response.statusCode ?? HttpStatus.CREATED,
          body,
        }, { ttlSeconds: IDEMPOTENCY_TTL });
        return body;
      }),
    );
  }
}
