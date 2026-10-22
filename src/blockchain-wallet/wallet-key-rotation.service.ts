import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockchainWallet } from './entities/blockchain-wallet.entity';
import { EncryptionService } from '../security/encryption.service';
import { AuditService } from '../audit/audit.service';

/** Outcome of a single key rotation run. */
export interface WalletKeyRotationResult {
  /** Version of the key new records are encrypted with. */
  activeKeyVersion: number;
  /** Every known key version (active + retired). */
  knownKeyVersions: number[];
  /** Number of wallet records inspected. */
  scanned: number;
  /** Number of records re-encrypted with the active key. */
  rotated: number;
  /** Number of records already encrypted with the active key. */
  skipped: number;
  /** Number of records that could not be re-encrypted. */
  failed: number;
  /** Per-record failures (the record is left untouched). */
  failures: Array<{ walletId: string; reason: string }>;
  /** True when nothing was written. */
  dryRun: boolean;
}

export interface WalletKeyRotationOptions {
  /** How many records to process per database round trip. */
  batchSize?: number;
  /** Inspect only — no record is written. */
  dryRun?: boolean;
}

interface RawWalletRow {
  id: string;
  encryptedSecretKey: string;
  keyVersion: number | null;
  iv: string | null;
}

/**
 * Re-encrypts Stellar wallet secrets with the active encryption key (#444).
 *
 * The rotation reads the raw ciphertext (bypassing the column transformer so
 * a single undecryptable record cannot abort the whole run), decrypts it with
 * the key version recorded on the record and writes it back encrypted with
 * the active key while bumping `keyVersion`.
 *
 * Records that cannot be decrypted are reported in `failures` and left
 * untouched, so the rotation is safe to retry.
 */
@Injectable()
export class WalletKeyRotationService {
  private readonly logger = new Logger(WalletKeyRotationService.name);

  private readonly DEFAULT_BATCH_SIZE = 100;

  constructor(
    @InjectRepository(BlockchainWallet)
    private readonly walletRepo: Repository<BlockchainWallet>,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
  ) {}

  /** Current key ring state, used by the admin endpoint. */
  getKeyRingStatus(): {
    activeKeyVersion: number;
    knownKeyVersions: number[];
    walletCount: number;
    walletsPerVersion: Record<string, number>;
  } {
    const activeKeyVersion = this.encryptionService.getActiveKeyVersion();
    return {
      activeKeyVersion,
      knownKeyVersions: this.encryptionService.getKnownKeyVersions(),
      walletCount: 0,
      walletsPerVersion: {},
    };
  }

  /**
   * Re-encrypts every wallet that is not encrypted with the active key.
   *
   * @param options batch size and dry-run flag
   */
  async rotateWallets(
    options: WalletKeyRotationOptions = {},
  ): Promise<WalletKeyRotationResult> {
    const batchSize = Math.max(1, options.batchSize ?? this.DEFAULT_BATCH_SIZE);
    const dryRun = options.dryRun === true;
    const activeVersion = this.encryptionService.getActiveKeyVersion();

    const result: WalletKeyRotationResult = {
      activeKeyVersion: activeVersion,
      knownKeyVersions: this.encryptionService.getKnownKeyVersions(),
      scanned: 0,
      rotated: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      dryRun,
    };

    const table = this.walletRepo.metadata.tableName;
    const rows = (await this.walletRepo.query(
      `SELECT "id", "encryptedSecretKey", "keyVersion", "iv" FROM "${table}" ORDER BY "createdAt" ASC`,
    )) as RawWalletRow[];

    for (const row of rows) {
      result.scanned += 1;
      const recordVersion = row.keyVersion ?? 1;

      if (recordVersion === activeVersion) {
        result.skipped += 1;
        continue;
      }

      try {
        const plaintext = this.decryptRecord(row, recordVersion);
        const reEncrypted = this.encryptionService.encrypt(plaintext, activeVersion);

        if (!dryRun) {
          await this.walletRepo.query(
            `UPDATE "${table}" SET "encryptedSecretKey" = $1, "keyVersion" = $2 WHERE "id" = $3`,
            [reEncrypted, activeVersion, row.id],
          );
        }

        result.rotated += 1;
      } catch (error) {
        result.failed += 1;
        const reason = error instanceof Error ? error.message : String(error);
        result.failures.push({ walletId: row.id, reason });
        this.logger.error(
          `Failed to rotate encryption key for wallet ${row.id}: ${reason}`,
        );
      }
    }

    this.logger.log(
      `Wallet key rotation finished (version ${activeVersion}, scanned ${result.scanned}, rotated ${result.rotated}, skipped ${result.skipped}, failed ${result.failed}, dryRun ${dryRun})`,
    );

    return result;
  }

  /**
   * Decrypts a stored record with the key version recorded on it, falling
   * back to any known key when the recorded version is unknown.
   */
  private decryptRecord(row: RawWalletRow, recordVersion: number): string {
    if (!row.encryptedSecretKey) {
      throw new Error('Encrypted secret key is empty');
    }

    // Legacy rows stored the IV separately and used the pre-`encv1` layout.
    if (row.iv) {
      return this.encryptionService.decryptLegacy(row.encryptedSecretKey, row.iv);
    }

    try {
      return this.encryptionService.decrypt(row.encryptedSecretKey, recordVersion);
    } catch {
      // The recorded version may be stale — try every registered key.
      return this.encryptionService.decrypt(row.encryptedSecretKey);
    }
  }

  /** Writes an audit entry for a rotation run. */
  async auditRotation(
    actor: string,
    result: WalletKeyRotationResult,
    ip?: string,
  ): Promise<void> {
    await this.auditService.log({
      actor,
      action: 'WALLET_KEY_ROTATION',
      resource: 'blockchain_wallets',
      after: {
        activeKeyVersion: result.activeKeyVersion,
        knownKeyVersions: result.knownKeyVersions,
        scanned: result.scanned,
        rotated: result.rotated,
        skipped: result.skipped,
        failed: result.failed,
        dryRun: result.dryRun,
      },
      ip,
    });
  }
}
