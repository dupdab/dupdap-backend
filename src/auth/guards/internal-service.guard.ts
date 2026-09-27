import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Guards controllers that are meant to be called only by trusted internal services
 * (e.g. the auth/registration service). Requires the caller to present a shared
 * secret in the `x-internal-service-secret` header that matches
 * `INTERNAL_SERVICE_SECRET`. The comparison is constant-time.
 *
 * If `INTERNAL_SERVICE_SECRET` is not configured, the route is denied outright so a
 * misconfiguration fails closed rather than leaving the endpoint wide open.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  private readonly logger = new Logger(InternalServiceGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('INTERNAL_SERVICE_SECRET');
    if (!configured) {
      this.logger.error(
        'INTERNAL_SERVICE_SECRET is not set — refusing all internal-only requests',
      );
      throw new UnauthorizedException('Internal endpoint not available');
    }

    const req = context.switchToHttp().getRequest();
    const provided = req.headers['x-internal-service-secret'];

    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException('Missing internal service credentials');
    }

    // Hash both sides so timingSafeEqual gets equal-length buffers.
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(configured).digest();
    if (!timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid internal service credentials');
    }

    return true;
  }
}
