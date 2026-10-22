import { HttpStatus } from '@nestjs/common';
import { BusinessException } from './business.exception';

/** Settlement could not be found for the given identifier. */
export class SettlementNotFoundException extends BusinessException {
  constructor(settlementId?: string) {
    super(
      'SETTLEMENT_NOT_FOUND',
      settlementId
        ? `Settlement ${settlementId} was not found.`
        : 'Settlement was not found.',
      HttpStatus.NOT_FOUND,
      settlementId ? { settlementId } : undefined,
    );
  }
}

/**
 * The settlement is not in `PENDING_APPROVAL`, so it cannot be approved or
 * rejected. Signals a stale admin view rather than a malformed request.
 */
export class SettlementNotPendingApprovalException extends BusinessException {
  constructor(currentStatus: string) {
    super(
      'SETTLEMENT_NOT_PENDING_APPROVAL',
      `Settlement is ${currentStatus}; only settlements awaiting approval can be decided.`,
      HttpStatus.CONFLICT,
      { currentStatus },
    );
  }
}

/** Settlement is in a state that cannot be retried. */
export class SettlementNotRetryableException extends BusinessException {
  constructor(currentStatus: string) {
    super(
      'SETTLEMENT_NOT_RETRYABLE',
      `Settlement is ${currentStatus}; only failed settlements can be retried.`,
      HttpStatus.CONFLICT,
      { currentStatus },
    );
  }
}

/** The fiat settlement partner is not configured or unreachable. */
export class SettlementPartnerException extends BusinessException {
  constructor(message = 'Settlement partner is not configured.') {
    super('SETTLEMENT_PARTNER_UNAVAILABLE', message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
