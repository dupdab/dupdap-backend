import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheService } from '../cache/cache.service';

const IDEMPOTENCY_TTL = 86_400; // 24 hours in seconds

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly cacheService: CacheService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['idempotency-key'];

    if (!idempotencyKey) {
      return next.handle();
    }

    const cacheKey = `idempotency:${idempotencyKey}`;
    const cached = await this.cacheService.get<{ status: number; body: any }>(cacheKey);

    if (cached) {
      const response = context.switchToHttp().getResponse();
      response.status(cached.status);
      return of(cached.body);
    }

    return next.handle().pipe(
      tap(async (body) => {
        const response = context.switchToHttp().getResponse();
        await this.cacheService.set(
          cacheKey,
          { status: response.statusCode ?? HttpStatus.CREATED, body },
          { ttlSeconds: IDEMPOTENCY_TTL },
        );
      }),
    );
  }
}
