/**
 * Thrown when AES-256-GCM decryption fails on a security-sensitive field.
 * Indicates corrupted/invalid ciphertext, wrong/rotated encryption key, or other crypto failure.
 * Should never be silently caught—must propagate for alerting and auditing.
 */
export class DecryptionFailedException extends Error {
  readonly fieldName: string;
  readonly originalError: unknown;

  constructor(fieldName: string, originalError: unknown) {
    const message = `Failed to decrypt field "${fieldName}"`;
    super(message);
    this.name = 'DecryptionFailedException';
    this.fieldName = fieldName;
    this.originalError = originalError;

    // Maintain proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}
