import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runWithCorrelationId } from '../correlation-id.context';

const MAX_CORRELATION_ID_LENGTH = 128;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveCorrelationId(headerValue: string | string[] | undefined): string {
  const clientCorrelationId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const trimmed = clientCorrelationId?.trim();
  if (
    trimmed &&
    trimmed.length <= MAX_CORRELATION_ID_LENGTH &&
    UUID_PATTERN.test(trimmed)
  ) {
    return trimmed;
  }
  return uuidv4();
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction) {
    const id = resolveCorrelationId(req.headers['x-correlation-id']);
    req.correlationId = id;
    res.setHeader('X-Correlation-ID', id);
    runWithCorrelationId(id, () => next());
  }
}
