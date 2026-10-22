import { HttpStatus } from '@nestjs/common';
import { BusinessException } from './business.exception';

/** No wallet is provisioned for the requested user. */
export class WalletNotFoundException extends BusinessException {
  constructor(userId?: string) {
    super(
      'WALLET_NOT_FOUND',
      'Wallet not provisioned for this user.',
      HttpStatus.NOT_FOUND,
      userId ? { userId } : undefined,
    );
  }
}

/** A wallet already exists for the user — provisioning is idempotent-safe. */
export class WalletAlreadyProvisionedException extends BusinessException {
  constructor(userId?: string) {
    super(
      'WALLET_ALREADY_PROVISIONED',
      'Wallet already provisioned for this user.',
      HttpStatus.CONFLICT,
      userId ? { userId } : undefined,
    );
  }
}

/** The stored wallet secret could not be decrypted (wrong/rotated key). */
export class WalletDecryptionFailedException extends BusinessException {
  constructor(message = 'Unable to decrypt wallet secret. Security team has been notified.') {
    super('WALLET_DECRYPTION_FAILED', message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
