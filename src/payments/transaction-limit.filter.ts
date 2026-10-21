import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { TransactionLimitExceededException } from './transaction-limit.exception';

/**
 * Maps TransactionLimitExceededException to a 429 response carrying the
 * `X-Limit-Reset` header (#553).
 */
@Catch(TransactionLimitExceededException)
export class TransactionLimitFilter implements ExceptionFilter {
  catch(exception: TransactionLimitExceededException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.setHeader('X-Limit-Reset', String(exception.resetAt));
    res.status(HttpStatus.TOO_MANY_REQUESTS).json({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      errorCode: 'TRANSACTION_LIMIT_EXCEEDED',
      message: 'Daily transaction limit exceeded. Please try again later.',
      retryAfter: exception.retryAfter,
      reset: exception.resetAt,
    });
  }
}
