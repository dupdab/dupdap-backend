import { ArgumentsHost, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { SorobanRpcException } from '../../stellar/soroban-rpc.exception';

interface RequestUser {
  merchantId?: string;
  email?: string;
  role?: string;
  id?: string;
  sub?: string;
}

interface RequestWithUser {
  user?: RequestUser;
  url?: string;
  method?: string;
}

export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly configService: ConfigService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<RequestWithUser>();
    const response = ctx.getResponse();

    const status = this.getStatus(exception);
    const responseBody = this.buildResponse(exception, request, status);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        'Unhandled exception caught by AllExceptionsFilter',
        exception instanceof Error ? exception.stack : String(exception),
      );
      if (this.configService.get<string>('SENTRY_DSN')) {
        this.captureWithUserContext(exception, request);
      }
    }

    response.status(status).json(responseBody);
  }

  private captureWithUserContext(exception: unknown, request: RequestWithUser): void {
    Sentry.withScope((scope) => {
      const user = request.user;
      if (user) {
        const id = user.merchantId ?? user.id ?? user.sub;
        if (id) {
          scope.setUser({
            id,
            email: user.email,
            ...(user.merchantId ? { merchantId: user.merchantId } : {}),
            ...(user.role ? { role: user.role } : {}),
          });
        }
      }

      scope.setContext('http_request', {
        url: request.url,
        method: request.method,
      });

      if (exception instanceof SorobanRpcException) {
        scope.setTag('blockchain', 'stellar-soroban');
        scope.setTag('soroban_code', exception.sorobanCode ?? 'unknown');
        scope.setContext('soroban', {
          code: exception.sorobanCode ?? null,
          rpcMethod: exception.rpcMethod ?? null,
          rpcParams: exception.rpcParams ?? null,
        });
        scope.addBreadcrumb({
          category: 'soroban.rpc',
          message: `Soroban RPC ${exception.rpcMethod ?? 'unknown'}`,
          data: {
            method: exception.rpcMethod ?? null,
            params: exception.rpcParams ?? null,
            code: exception.sorobanCode ?? null,
          },
          level: 'error',
        });
      }

      Sentry.captureException(exception);
    });
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof SorobanRpcException) {
      return exception.statusCode;
    }
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private buildResponse(exception: unknown, request: RequestWithUser, status: number) {
    const defaults: Record<number, [string, string]> = {
      400: ['INVALID_REQUEST', 'Check the request fields and try again.'],
      401: ['AUTHENTICATION_REQUIRED', 'Sign in or provide valid API credentials.'],
      403: ['ACCESS_DENIED', 'Your account does not have permission for this action.'],
      404: ['RESOURCE_NOT_FOUND', 'The requested resource was not found. Check its identifier.'],
      405: ['METHOD_NOT_ALLOWED', 'Use a supported HTTP method for this endpoint.'],
      406: ['NOT_ACCEPTABLE', 'Use a supported API version or response format.'],
      408: ['REQUEST_TIMEOUT', 'The request timed out. Check operation status before retrying.'],
      422: ['INVALID_REQUEST', 'Correct the request fields and try again.'],
      409: [
        'RESOURCE_CONFLICT',
        'The request conflicts with the current resource state. Refresh and try again.',
      ],
      410: ['RESOURCE_EXPIRED', 'This resource has expired. Create a new request.'],
      413: ['PAYLOAD_TOO_LARGE', 'Reduce the request size and try again.'],
      429: ['RATE_LIMIT_EXCEEDED', 'Too many requests. Wait before trying again.'],
      500: [
        'INTERNAL_ERROR',
        'We could not complete your request. Try again later or contact support.',
      ],
      502: [
        'UPSTREAM_UNAVAILABLE',
        'An external service is unavailable. Check the operation status before retrying.',
      ],
      503: ['SERVICE_UNAVAILABLE', 'This service is temporarily unavailable. Try again later.'],
      504: [
        'UPSTREAM_TIMEOUT',
        'An external service timed out. Check the operation status before retrying.',
      ],
    };
    let [errorCode, message]: [string, string | string[]] = defaults[status] ?? defaults[500];
    let error = HttpStatus[status] ?? 'Error';

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      // Only intentional client errors are public. Database, SDK and server
      // errors remain in logs/Sentry and never become consumer instructions.
      if (status < 500) {
        if (typeof body === 'string') message = body;
        else if (body && typeof body === 'object') {
          const detail = body as Record<string, unknown>;
          if (typeof detail.error === 'string') error = detail.error;
          if (
            typeof detail.message === 'string' ||
            (Array.isArray(detail.message) &&
              detail.message.every((item) => typeof item === 'string'))
          ) {
            message = detail.message as string | string[];
          }
          if (typeof detail.errorCode === 'string' && /^[A-Z][A-Z0-9_]*$/.test(detail.errorCode)) {
            errorCode = detail.errorCode;
          }
        }
      }
    }
    if (exception instanceof SorobanRpcException) {
      errorCode = 'BLOCKCHAIN_OPERATION_FAILED';
      message =
        'The blockchain operation could not be completed. Check the payment status before retrying.';
    }

    return {
      statusCode: status,
      error,
      errorCode,
      message,
      timestamp: new Date().toISOString(),
      path: request?.url ?? '',
    };
  }
}
