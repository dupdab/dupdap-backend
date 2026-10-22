import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  EncryptionKeyConfigurationException,
  InvalidEncryptedPayloadException,
} from './encryption.exceptions';

const ENCRYPTED_PREFIX = 'encv1';
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Default version of the active encryption key. */
export const DEFAULT_KEY_VERSION = 1;

let diManagedInstance: EncryptionService | null = null;

interface KeyRing {
  /** Version of the key used to encrypt new records. */
  activeVersion: number;
  /** Every known key material indexed by its version. */
  keys: Map<number, Buffer>;
}

/**
 * AES-256-GCM encryption for sensitive columns.
 *
 * ## Key rotation (#444)
 *
 * Every key has a numeric *version*. The active key comes from
 * `ENCRYPTION_KEY` and its version from `ENCRYPTION_KEY_VERSION` (default 1).
 * Retired keys stay available for decryption and are supplied either as
 * `ENCRYPTION_KEY_V<n>` or through the `ENCRYPTION_KEY_FALLBACKS` list
 * (`<version>:<key>,<version>:<key>`).
 *
 * `encrypt()` always uses the active key. `decrypt()` accepts an optional
 * `keyVersion` (the version recorded next to the ciphertext, e.g.
 * `blockchain_wallets.keyVersion`) and, when it is omitted, falls back to
 * trying every known key so records written before the version column
 * existed still decrypt.
 *
 * See `src/backup/RECOVERY_DRILL.md` for the rotation runbook.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly keyRing: KeyRing;

  constructor() {
    this.keyRing = this.resolveKeyRing();
    diManagedInstance = this;
  }

  /**
   * Returns the Nest DI-managed instance of EncryptionService.
   *
   * TypeORM column transformers are plain functions with no access to Nest's
   * DI container, so they need a way to reach the single DI-managed instance
   * rather than constructing a parallel one. This reference is set once when
   * Nest instantiates the service and is the only instance used for encryption
   * and decryption across the app.
   */
  static getInstance(): EncryptionService {
    if (!diManagedInstance) {
      throw new EncryptionKeyConfigurationException(
        'EncryptionService has not been initialized by the Nest DI container yet',
      );
    }
    return diManagedInstance;
  }

  /** Version of the key used for new encryptions. */
  getActiveKeyVersion(): number {
    return this.keyRing.activeVersion;
  }

  /** Every key version this instance is able to decrypt with. */
  getKnownKeyVersions(): number[] {
    return Array.from(this.keyRing.keys.keys()).sort((a, b) => a - b);
  }

  /**
   * Encrypts with the active key (or an explicit key version).
   *
   * The payload keeps the historic `encv1:<iv>:<tag>:<ciphertext>` layout so
   * previously stored rows stay readable; the key *version* is tracked in a
   * dedicated column next to the ciphertext.
   */
  encrypt(plaintext: string, keyVersion?: number): string {
    if (!plaintext) return plaintext;

    const version = keyVersion ?? this.keyRing.activeVersion;
    const key = this.keyRing.keys.get(version);
    if (!key) {
      throw new EncryptionKeyConfigurationException(
        `No encryption key registered for version ${version}`,
      );
    }

    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      ENCRYPTED_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypts a stored payload.
   *
   * @param ciphertext stored payload
   * @param keyVersion version recorded for that payload. When omitted, every
   * registered key is tried (newest first) so payloads written before the
   * version column existed still decrypt.
   */
  decrypt(ciphertext: string, keyVersion?: number): string {
    if (!ciphertext) return ciphertext;
    if (!ciphertext.startsWith(`${ENCRYPTED_PREFIX}:`)) {
      return ciphertext;
    }

    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
      throw new InvalidEncryptedPayloadException();
    }
    const [prefix, ivB64, tagB64, payloadB64] = parts;
    if (prefix !== ENCRYPTED_PREFIX || !ivB64 || !tagB64 || !payloadB64) {
      throw new InvalidEncryptedPayloadException();
    }

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const payload = Buffer.from(payloadB64, 'base64');

    if (iv.length !== GCM_IV_BYTES || authTag.length !== GCM_TAG_BYTES) {
      throw new InvalidEncryptedPayloadException('Invalid encrypted payload components');
    }

    if (keyVersion !== undefined) {
      const key = this.keyRing.keys.get(keyVersion);
      if (!key) {
        throw new EncryptionKeyConfigurationException(
          `No encryption key registered for version ${keyVersion}`,
        );
      }
      return this.decryptWithKey(ciphertext, key, iv, authTag, payload);
    }

    for (const version of this.getKnownKeyVersions().reverse()) {
      const key = this.keyRing.keys.get(version);
      if (!key) continue;
      try {
        return this.decryptWithKey(ciphertext, key, iv, authTag, payload);
      } catch {
        // Try the next registered key version.
      }
    }

    throw new InvalidEncryptedPayloadException('Unable to decrypt payload with any known key');
  }

  private decryptWithKey(
    _ciphertext: string,
    key: Buffer,
    iv: Buffer,
    authTag: Buffer,
    payload: Buffer,
  ): string {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  decryptLegacy(ciphertext: string, ivHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const [authTagHex, encryptedHex] = ciphertext.split(':');
    if (!authTagHex || !encryptedHex) {
      throw new InvalidEncryptedPayloadException('Invalid legacy encrypted payload');
    }

    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', this.activeKey(), iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  logDecryptionFailure(fieldName: string, error: unknown): void {
    this.logger.error(
      `[SECURITY_EVENT] Failed to decrypt "${fieldName}"`,
      error instanceof Error ? error.stack : String(error),
    );
  }

  private activeKey(): Buffer {
    const key = this.keyRing.keys.get(this.keyRing.activeVersion);
    if (!key) {
      throw new EncryptionKeyConfigurationException('ENCRYPTION_KEY is not set');
    }
    return key;
  }

  private resolveKeyRing(): KeyRing {
    const rawKey = process.env.ENCRYPTION_KEY;
    if (!rawKey) {
      throw new EncryptionKeyConfigurationException('ENCRYPTION_KEY is not set');
    }

    const activeVersion = this.resolveActiveVersion();
    const keys = new Map<number, Buffer>();
    keys.set(activeVersion, this.resolveKeyMaterial(rawKey));

    for (const [version, material] of this.resolveFallbackKeys()) {
      if (version === activeVersion) continue;
      keys.set(version, this.resolveKeyMaterial(material));
    }

    this.logger.log(
      `Encryption key ring ready (active version ${activeVersion}, known versions ${Array.from(keys.keys())
        .sort((a, b) => a - b)
        .join(', ')})`,
    );

    return { activeVersion, keys };
  }

  private resolveActiveVersion(): number {
    const raw = process.env.ENCRYPTION_KEY_VERSION;
    if (!raw) return DEFAULT_KEY_VERSION;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new EncryptionKeyConfigurationException(
        'ENCRYPTION_KEY_VERSION must be a positive integer',
      );
    }
    return parsed;
  }

  /**
   * Historical key material, from `ENCRYPTION_KEY_V<n>` variables and/or the
   * `ENCRYPTION_KEY_FALLBACKS` list (`<version>:<key>` entries).
   */
  private resolveFallbackKeys(): Array<[number, string]> {
    const entries: Array<[number, string]> = [];

    for (const [name, value] of Object.entries(process.env)) {
      const match = /^ENCRYPTION_KEY_V(\d+)$/.exec(name);
      if (match && value) {
        entries.push([Number.parseInt(match[1], 10), value]);
      }
    }

    const fallbacks = process.env.ENCRYPTION_KEY_FALLBACKS;
    if (fallbacks) {
      for (const item of fallbacks.split(',')) {
        const trimmed = item.trim();
        if (!trimmed) continue;
        const separator = trimmed.indexOf(':');
        if (separator <= 0) {
          throw new EncryptionKeyConfigurationException(
            'ENCRYPTION_KEY_FALLBACKS entries must use the "<version>:<key>" format',
          );
        }
        const version = Number.parseInt(trimmed.slice(0, separator), 10);
        if (!Number.isInteger(version) || version < 1) {
          throw new EncryptionKeyConfigurationException(
            'ENCRYPTION_KEY_FALLBACKS entries must start with a positive integer version',
          );
        }
        entries.push([version, trimmed.slice(separator + 1)]);
      }
    }

    return entries;
  }

  private resolveKeyMaterial(rawKey: string): Buffer {
    const utf8Key = Buffer.from(rawKey, 'utf8');
    if (utf8Key.length === 32) {
      return utf8Key;
    }

    const hexKey = /^[a-fA-F0-9]{64}$/.test(rawKey)
      ? Buffer.from(rawKey, 'hex')
      : null;
    if (hexKey && hexKey.length === 32) {
      return hexKey;
    }

    const base64Key = /^[A-Za-z0-9+/]+={0,2}$/.test(rawKey)
      ? Buffer.from(rawKey, 'base64')
      : null;
    if (base64Key && base64Key.length === 32) {
      return base64Key;
    }

    throw new EncryptionKeyConfigurationException(
      'ENCRYPTION_KEY must resolve to exactly 32 bytes (raw utf8, base64, or hex)',
    );
  }
}
