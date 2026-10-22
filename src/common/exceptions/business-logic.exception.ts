import { BadRequestException } from '@nestjs/common';

/**
 * Base exception for business-logic failures that should surface as 400-level
 * HTTP responses instead of 500s. Subclasses set a stable `errorCode` so
 * clients (and the global exception filter) can handle them deterministically.
 */
export class BusinessLogicException extends BadRequestException {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super({ errorCode, message });
    this.errorCode = errorCode;
    this.name = this.constructor.name;
  }
}
