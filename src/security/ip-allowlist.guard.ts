import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

function ipInCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return ip === cidr;

  const [range, bits] = cidr.split('/');
  const mask = ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0;

  const toInt = (addr: string) =>
    addr.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;

  try {
    return (toInt(ip) & mask) === (toInt(range) & mask);
  } catch {
    return false;
  }
}

/**
 * Resolve the client IP for allowlist checks.
 *
 * We deliberately do NOT parse `X-Forwarded-For` by hand: that header is
 * attacker-controlled unless a trusted reverse proxy overwrites it. Instead we
 * rely on Express's `req.ip`, which honours the app's `trust proxy` setting
 * (configured in `main.ts` from the `TRUST_PROXY` env var). When no trusted
 * proxy is configured, `req.ip` is the raw socket address and cannot be
 * spoofed; when one is, Express derives the left-most untrusted address for us.
 * `req.socket.remoteAddress` is the last-resort fallback.
 */
function getClientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

@Injectable()
export class IpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(IpAllowlistGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const isDev = this.config.get<string>('NODE_ENV') === 'development';
    const bypassInDev = this.config.get<string>('ADMIN_IP_BYPASS_IN_DEV') === 'true';

    if (isDev && bypassInDev) return true;

    const raw = this.config.get<string>('ADMIN_ALLOWED_IPS', '');
    const allowedEntries = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const req = context.switchToHttp().getRequest<Request>();
    const clientIp = getClientIp(req);

    if (allowedEntries.length === 0 || !allowedEntries.some((entry) => ipInCidr(clientIp, entry))) {
      this.logger.warn(
        `[Security] Blocked admin access from IP=${clientIp} ${req.method} ${req.originalUrl}`,
      );
      throw new ForbiddenException('Access denied: IP not in allowlist');
    }

    return true;
  }
}
