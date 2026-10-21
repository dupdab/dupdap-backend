import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { runWithCorrelationId } from "../correlation-id.context";

const MAX_CORRELATION_ID_LENGTH = 128;

function resolveCorrelationId(
  headerValue: string | string[] | undefined,
): string {
  const clientCorrelationId = Array.isArray(headerValue)
    ? headerValue[0]
    : headerValue;
  const trimmed = clientCorrelationId?.trim();
  if (
    trimmed &&
    trimmed.length <= MAX_CORRELATION_ID_LENGTH &&
    /^[a-zA-Z0-9._:-]+$/.test(trimmed)
  ) {
    return trimmed;
  }
  return randomUUID();
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(
    req: Request & { correlationId?: string; requestId?: string },
    res: Response,
    next: NextFunction,
  ) {
    const id = resolveCorrelationId(
      req.headers["x-request-id"] ?? req.headers["x-correlation-id"],
    );
    req.correlationId = id;
    req.requestId = id;
    res.setHeader("X-Request-ID", id);
    res.setHeader("X-Correlation-ID", id);
    runWithCorrelationId(id, () => next());
  }
}
