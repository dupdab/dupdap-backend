import { EncryptionService } from './encryption.service';
import { encryptedColumnTransformer } from './encrypted-column.transformer';
import { DecryptionFailedException } from './decryption-failed.exception';

const MOCK_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';

describe('encryptedColumnTransformer', () => {
  let encryptionService: EncryptionService;
  const fieldName = 'test.field';

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = MOCK_ENCRYPTION_KEY;
    encryptionService = EncryptionService.getSingleton();
  });

  describe('to() — encryption on write', () => {
    it('encrypts a plaintext value', () => {
      const transformer = encryptedColumnTransformer(fieldName);
      const plaintext = 'secret-value';
      const encrypted = transformer.to(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).toContain('encv1:');
    });

    it('returns null or empty string unchanged', () => {
      const transformer = encryptedColumnTransformer(fieldName);

      expect(transformer.to(null)).toBeNull();
      expect(transformer.to('')).toBe('');
    });

    it('returns already-encrypted value unchanged', () => {
      const transformer = encryptedColumnTransformer(fieldName);
      const alreadyEncrypted = 'encv1:aaaa:bbbb:cccc';
      expect(transformer.to(alreadyEncrypted)).toBe(alreadyEncrypted);
    });
  });

  describe('from() — decryption on read (happy path)', () => {
    it('decrypts a valid encrypted value', () => {
      const transformer = encryptedColumnTransformer(fieldName);
      const plaintext = 'secret-value';
      const encrypted = encryptionService.encrypt(plaintext);

      const decrypted = transformer.from(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('returns null or empty string unchanged', () => {
      const transformer = encryptedColumnTransformer(fieldName);

      expect(transformer.from(null)).toBeNull();
      expect(transformer.from('')).toBe('');
    });
  });

  describe('from() — decryption failure handling', () => {
    it('throws DecryptionFailedException on malformed ciphertext', () => {
      const transformer = encryptedColumnTransformer(fieldName);
      const malformed = 'encv1:invalid:payload';

      expect(() => transformer.from(malformed)).toThrow(DecryptionFailedException);
    });

    it('DecryptionFailedException contains fieldName for debugging', () => {
      const transformer = encryptedColumnTransformer(fieldName);
      const malformed = 'encv1:invalid:payload';

      let caughtException: DecryptionFailedException | null = null;
      try {
        transformer.from(malformed);
      } catch (err) {
        caughtException = err as DecryptionFailedException;
      }

      expect(caughtException).not.toBeNull();
      expect(caughtException!.fieldName).toBe(fieldName);
    });

    it('DecryptionFailedException does not leak ciphertext or keys', () => {
      const transformer = encryptedColumnTransformer(fieldName);
      const malformed = 'encv1:invalid:payload';

      let caughtException: DecryptionFailedException | null = null;
      try {
        transformer.from(malformed);
      } catch (err) {
        caughtException = err as DecryptionFailedException;
      }

      expect(caughtException!.message).not.toContain('invalid:payload');
      expect(caughtException!.message).not.toContain(MOCK_ENCRYPTION_KEY);
    });

    it('throws DecryptionFailedException on wrong encryption key', () => {
      // Encrypt with one key
      const plaintext = 'secret-value';
      const encrypted = encryptionService.encrypt(plaintext);

      // Switch to different key without clearing singleton
      const differentKey = 'fedcba9876543210fedcba9876543210';
      process.env.ENCRYPTION_KEY = differentKey;
      // Force singleton reset
      (EncryptionService as any).singleton = null;

      const transformer = encryptedColumnTransformer(fieldName);
      // Attempt decrypt with wrong key — should fail
      expect(() => transformer.from(encrypted)).toThrow(DecryptionFailedException);

      // Restore original key
      process.env.ENCRYPTION_KEY = MOCK_ENCRYPTION_KEY;
      (EncryptionService as any).singleton = null;
    });

    it('throws DecryptionFailedException on corrupted ciphertext (wrong base64)', () => {
      const transformer = encryptedColumnTransformer(fieldName);
      // Valid format but invalid base64 payload
      const corrupted = 'encv1:aaa:bbb:!!!not-base64!!!';

      expect(() => transformer.from(corrupted)).toThrow(DecryptionFailedException);
    });

    it('logDecryptionFailure is called before throwing', () => {
      const transformer = encryptedColumnTransformer(fieldName);
      const logSpy = jest.spyOn(encryptionService, 'logDecryptionFailure');
      const malformed = 'encv1:invalid:payload';

      try {
        transformer.from(malformed);
      } catch (err) {
        // Expected to throw
      }

      expect(logSpy).toHaveBeenCalledWith(fieldName, expect.any(Error));
      logSpy.mockRestore();
    });
  });

  describe('field name context', () => {
    it('includes field name in exception for security-sensitive fields like encryptedSecretKey', () => {
      const sensitiveFieldName = 'blockchain_wallets.encryptedSecretKey';
      const transformer = encryptedColumnTransformer(sensitiveFieldName);
      const malformed = 'encv1:invalid';

      let caughtException: DecryptionFailedException | null = null;
      try {
        transformer.from(malformed);
      } catch (err) {
        caughtException = err as DecryptionFailedException;
      }

      expect(caughtException!.fieldName).toBe(sensitiveFieldName);
    });

    it('includes field name in exception for other encrypted fields like bankAccountNumber', () => {
      const fieldName2 = 'merchants.bankAccountNumber';
      const transformer = encryptedColumnTransformer(fieldName2);
      const malformed = 'encv1:invalid';

      let caughtException: DecryptionFailedException | null = null;
      try {
        transformer.from(malformed);
      } catch (err) {
        caughtException = err as DecryptionFailedException;
      }

      expect(caughtException!.fieldName).toBe(fieldName2);
    });
  });
});
