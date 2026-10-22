import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Body returned to API clients for business rule violations.
 *
 * `errorCode` is a stable, machine-readable identifier (SCREAMING_SNAKE_CASE)
 * that clients can branch on, while `message` stays human readable. The
 * global exception filter (`src/core/filters/all-exceptions.filter.ts`)
 * forwards both fields verbatim to the client.
 */
export interface BusinessExceptionBody {
  errorCode: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Base class for every domain/business rule violation.
 *
 * Raw `Error` instances are caught by NestJS as a generic 500, which hides
 * the real reason from API consumers and makes client-side error handling
 * impossible. Business exceptions carry an explicit HTTP status and a stable
 * error code so a caller receives a 4xx with a machine-readable reason.
 */
export class BusinessException extends HttpException {
  readonly errorCode: string;
  readonly details?: Record<string, unknown>;

  constructor(
    errorCode: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: Record<string, unknown>,
  ) {
    const body: BusinessExceptionBody = { errorCode, message };
    if (details && Object.keys(details).length > 0) {
      body.details = details;
    }
    super(body, status);
    this.errorCode = errorCode;
    this.details = details;
    this.name = new.target.name;
    Error.captureStackTrace(this, new.target);
  }

  /** Serialisable representation used by the global exception filter. */
  toBody(): BusinessExceptionBody {
    return this.details
      ? { errorCode: this.errorCode, message: this.message, details: this.details }
      : { errorCode: this.errorCode, message: this.message };
  }
}
