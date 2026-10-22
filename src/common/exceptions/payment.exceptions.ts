import { HttpStatus } from '@nestjs/common';
import { BusinessException } from './business.exception';

/** Payment could not be found for the given identifier. */
export class PaymentNotFoundException extends BusinessException {
  constructor(paymentId?: string) {
    super(
      'PAYMENT_NOT_FOUND',
      paymentId ? `Payment ${paymentId} was not found.` : 'Payment was not found.',
      HttpStatus.NOT_FOUND,
      paymentId ? { paymentId } : undefined,
    );
  }
}

/**
 * Payment window elapsed before the customer completed the transfer.
 * The client must create a new payment — retrying the same one is futile.
 */
export class PaymentExpiredException extends BusinessException {
  constructor(paymentId?: string) {
    super(
      'PAYMENT_EXPIRED',
      'This payment has expired. Create a new payment.',
      HttpStatus.GONE,
      paymentId ? { paymentId } : undefined,
    );
  }
}

/** The merchant/customer wallet does not hold enough funds for the operation. */
export class InsufficientFundsException extends BusinessException {
  constructor(
    message = 'Insufficient funds to complete this operation.',
    details?: Record<string, unknown>,
  ) {
    super('INSUFFICIENT_FUNDS', message, HttpStatus.BAD_REQUEST, details);
  }
}

/** A payment with the same reference/memo already exists. */
export class DuplicatePaymentException extends BusinessException {
  constructor(reference?: string) {
    super(
      'DUPLICATE_PAYMENT',
      reference
        ? `A payment with reference ${reference} already exists.`
        : 'A payment with this reference already exists.',
      HttpStatus.CONFLICT,
      reference ? { reference } : undefined,
    );
  }
}

/** The requested transition is not allowed from the payment's current state. */
export class PaymentStateException extends BusinessException {
  constructor(currentStatus: string, expected: string | string[]) {
    const expectedText = Array.isArray(expected) ? expected.join(' or ') : expected;
    super(
      'INVALID_PAYMENT_STATE',
      `Payment is ${currentStatus}; only ${expectedText} payments can perform this action.`,
      HttpStatus.CONFLICT,
      { currentStatus, expected },
    );
  }
}
