import { BusinessLogicException } from './business-logic.exception';

/**
 * Thrown when a merchant or wallet does not have sufficient funds to complete
 * an operation (e.g. a settlement or payout). Mapped to HTTP 400.
 */
export class InsufficientFundsException extends BusinessLogicException {
  constructor(available?: string, required?: string) {
    super(
      'INSUFFICIENT_FUNDS',
      available && required
        ? `Insufficient funds: available ${available}, required ${required}.`
        : 'Insufficient funds to complete this operation.',
    );
  }
}
