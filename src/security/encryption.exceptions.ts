import { InternalServerErrorException } from '@nestjs/common';

/**
 * Raised when the encryption configuration is missing or malformed.
 *
 * Never leaks key material — the message only names the offending variable.
 */
export class EncryptionKeyConfigurationException extends InternalServerErrorException {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyConfigurationException';
  }
}

/** Raised when a stored ciphertext is structurally invalid or truncated. */
export class InvalidEncryptedPayloadException extends InternalServerErrorException {
  constructor(message = 'Invalid encrypted payload format') {
    super(message);
    this.name = 'InvalidEncryptedPayloadException';
  }
}

/**
 * Raised when a record could not be re-encrypted during a key rotation.
 * The record is left untouched so the rotation can be retried safely.
 */
export class KeyRotationException extends InternalServerErrorException {
  constructor(message: string) {
    super(message);
    this.name = 'KeyRotationException';
  }
}
