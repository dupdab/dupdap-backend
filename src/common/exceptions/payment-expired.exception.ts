import { BusinessLogicException } from './business-logic.exception';

/**
 * Thrown when a payment has expired and can no longer be acted upon.
 * Clients should create a new payment. Mapped to HTTP 400.
 */
export class PaymentExpiredException extends BusinessLogicException {
  constructor(paymentId?: string) {
    super(
      'PAYMENT_EXPIRED',
      paymentId
        ? `Payment ${paymentId} has expired. Create a new payment.`
        : 'Payment has expired. Create a new payment.',
    );
  }
}
