# Audit: DecryptionFailedException Implementation

## Call Sites Audited

### BlockchainWallet.encryptedSecretKey
**File**: `src/blockchain-wallet/entities/blockchain-wallet.entity.ts:25`
- Entity column using `encryptedColumnTransformer('blockchain_wallets.encryptedSecretKey')`
- **Call path**: `BlockchainWalletService.decryptSecretKey()` (line 114)
  - Checks `if (!wallet.encryptedSecretKey)` but this is AFTER TypeORM has already loaded the entity
  - If decrypt fails during load, exception now propagates before this method is reached
  - No code path relied on `null` return meaning "not set"
  - Legacy decrypt path (`decryptLegacy()`) is manual and unaffected by transformer changes

### Merchant.bankAccountNumber
**File**: `src/merchants/entities/merchant.entity.ts:51`
- Entity column marked `nullable: true`, uses `encryptedColumnTransformer('merchants.bankAccountNumber')`
- **Legitimate null handling preserved**: `if (value == null || value === '')` in transformer still returns value as-is
- No code paths rely on decrypt-failure-as-null behavior
- Actual null DB values (field never set) will still load as null without triggering transformer

## Impact Assessment

✅ **No breaking changes** — Both call sites correctly handle the new throw behavior:
1. Null/empty values still return null (legitimate field-not-set case)
2. Non-null encrypted values that decrypt successfully still return plaintext unchanged
3. Non-null encrypted values that fail to decrypt now throw `DecryptionFailedException` instead of returning `null`
   - This exception propagates during entity load, caught by global error handlers
   - Services calling these entities will receive the exception, not a silent `null`
   - This is the desired behavior (alert on crypto failure, not silent masking)

## Tests Coverage
- Existing mocked tests in `blockchain-wallet.service.spec.ts` use mock repositories and don't trigger the actual transformer
- New transformer unit tests verify the three paths: null pass-through, successful decrypt, and decrypt-failure-throws
