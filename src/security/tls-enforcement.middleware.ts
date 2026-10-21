import { Injectable, NestMiddleware, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { getCorrelationId } from '../common/correlation-id.context';
import type { NextFunction, Request, Response } from 'express';

const TLS_MINIMUM = /^TLSv1\.(2|3)$/i;

@Injectable()
export class TlsEnforcementMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TlsEnforcementMiddleware.name);

  private sendError(res: Response, statusCode: number, error: string, message: string): void {
    const requestId = getCorrelationId() ?? randomUUID();
    res.setHeader('X-Request-ID', requestId);
    res.status(statusCode).json({ statusCode, error, message, requestId });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const forwardedProto =
      (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim().toLowerCase();
    const isSecure = req.secure || forwardedProto === 'https';

    if (!isSecure) {
      this.logger.warn(
        `Rejected non-secure request: ${req.method} ${req.originalUrl} from ${req.ip}`,
      );
      this.sendError(res, HttpStatus.UPGRADE_REQUIRED, 'Upgrade Required', 'HTTPS is required for all requests.');
      return;
    }

    const socket = req.socket as unknown as { getProtocol?: () => string };
    const tlsProtocol = socket.getProtocol?.();
    if (tlsProtocol && !TLS_MINIMUM.test(tlsProtocol)) {
      this.logger.warn(
        `Rejected weak TLS protocol: ${tlsProtocol} for ${req.method} ${req.originalUrl}`,
      );
      this.sendError(res, HttpStatus.FORBIDDEN, 'Forbidden', 'TLS 1.2 or higher is required.');
      return;
    }

    next();
  }
}
