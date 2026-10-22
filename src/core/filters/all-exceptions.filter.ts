import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import { SorobanRpcException } from '../../stellar/soroban-rpc.exception';

const SENSITIVE_STRING_PATTERNS: RegExp[] = [
  /password=[^&\s]+/gi,
  /secret=[^&\s]+/gi,
  /api[_-]?key=[^&\s]+/gi,
  /token=[^&\s]+/gi,
  /\bS[A-Z2-7]{55}\b/g, // Stellar secret keys
];

function scrub(value: unknown): unknown {
  if (typeof value === 'string') {
    let result = value;
    for (const pattern of SENSITIVE_STRING_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /(password|secret|token|key|private|seed|mnemonic)/i.test(k)
        ? '[REDACTED]'
        : scrub(v);
    }
    return out;
  }
  return value;
}

function errorCodeFor(status: number): string {
  const map: Record<number, string> = {
    400: 'INVALID_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    410: 'GONE',
    413: 'PAYLOAD_TOO_LARGE',
    429: 'RATE_LIMITED',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE',
    504: 'GATEWAY_TIMEOUT',
  };
  return map[status] ?? 'INTERNAL_ERROR';
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof SorobanRpcException) {
      Sentry.captureException(exception);
      Sentry.withScope((scope: unknown) => {
        scope['setTag']?.('blockchain', 'stellar-soroban');
        scope['setContext']?.('soroban', {
          rpcMethod: exception.rpcMethod,
          rpcParams: exception.rpcParams,
          sorobanCode: exception.sorobanCode,
        });
        scope['addBreadcrumb']?.({
          category: 'soroban.rpc',
          message: exception.message,
          level: 'error',
        });
      });
    } else if (exception instanceof Error) {
      Sentry.captureException(exception);
      this.logger.error(
        `Unhandled error: ${exception.message}\n${exception.stack}`,
      );
    } else {
      Sentry.captureException(exception);
      this.logger.error(`Unhandled error: ${String(exception)}`);
    }

    let body: Record<string, unknown>;

    if (exception instanceof HttpException) {
      const resp = exception.getResponse();
      body = {
        errorCode:
          (resp as Record<string, unknown>)?.errorCode ?? errorCodeFor(status),
        message: (resp as Record<string, unknown>)?.message ?? exception.message,
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request?.url ?? '',
      };
    } else {
      body = {
        errorCode: 'INTERNAL_ERROR',
        message: 'Try again later',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: new Date().toISOString(),
        path: request?.url ?? '',
      };
    }

    body = scrub(body) as Record<string, unknown>;

    const httpAdapter = this.httpAdapterHost?.httpAdapter;
    if (httpAdapter) {
      httpAdapter.reply(response, body, status);
    } else {
      response.status(status).json(body);
    }
  }
}
