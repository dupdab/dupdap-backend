import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown when a merchant exceeds their rolling 24h transaction limit (#553).
 * A TransactionLimitFilter maps this to a 429 response with the
 * `X-Limit-Reset` header.
 */
export class TransactionLimitExceededException extends HttpException {
  /** Unix timestamp (seconds) at which the rolling window resets. */
  readonly resetAt: number;

  /** Seconds until the rolling window resets. */
  readonly retryAfter: number;

  constructor(resetAt: number, retryAfter?: number) {
    const now = Math.floor(Date.now() / 1000);
    const retry = Math.max(retryAfter ?? Math.max(resetAt - now, 0), 0);
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Daily transaction limit exceeded. Please try again later.',
        retryAfter: retry,
        reset: resetAt,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.resetAt = resetAt;
    this.retryAfter = retry;
  }
}
