# Payment hardening fixes

Summary of four issues fixed on branch `fix/payment-index-validation-tsconfig-strictness`.

## 1. Missing indexes on `payments.merchantId` (bug, tech-debt)

`src/payments/entities/payment.entity.ts` had no `@Index` decorators. Since
`merchantId` is the WHERE clause for `PaymentsService.findAll()`,
`findOne()`, and `getStats()` (`src/payments/payments.service.ts`), and is
also the AML velocity-check join key (`AmlService.checkAndFlag`), every
merchant-scoped query was a sequential scan.

**Fix:** added `@Index()` on `merchantId`, plus composite
`@Index(['merchantId', 'status'])` and `@Index(['merchantId', 'createdAt'])`
on the `Payment` entity to match actual query patterns (status filtering,
date-range/list queries). A migration will need to be generated/run against
the target database to materialize these indexes.

## 2. Unbounded `amountUsd` and `metadata` on payment creation (bug, security)

`src/payments/dto/create-payment.dto.ts` validated `amountUsd` with only
`@IsNumber()`/`@IsPositive()` (no ceiling) and `metadata` with only
`@IsObject()` (no size limit), storing directly into a `jsonb` column.

**Fix:**
- Added `@Max(1_000_000)` to `amountUsd` in both `CreatePaymentDto` and
  `BatchPaymentItemDto`.
- Added a new reusable custom validator,
  `src/common/decorators/max-json-size.decorator.ts` (`@MaxJsonSize`), which
  rejects a field whose serialized JSON size exceeds a configured byte
  limit. Applied `@MaxJsonSize(4096)` to `metadata` on both the single and
  batch payment DTOs.

## 3. `expiryMinutes` had no bounds on single-payment creation (bug)

`CreatePaymentDto.expiryMinutes` only had `@IsNumber()`, unlike
`BatchPaymentItemDto.expiryMinutes` which already had `@IsPositive()`. This
allowed `expiryMinutes: 0`/negative (payment expired at creation) or an
arbitrarily large value (never-expiring payment).

**Fix:** added `@IsPositive()` and `@Max(1440)` (24h cap) to
`CreatePaymentDto.expiryMinutes`, aligning it with the batch DTO (which also
got the same `@Max(1440)` cap for consistency).

## 4. `strictNullChecks` / `noImplicitAny` disabled (tech-debt)

`tsconfig.json` had both flags set to `false`, disabling two of
TypeScript's most important safety nets for a codebase full of
`nullable: true` entity columns and optional DTO fields.

**Fix:** flipped `strictNullChecks` and `noImplicitAny` to `true` in
`tsconfig.json`.

**Follow-up required:** enabling these flags project-wide will surface
existing null/undefined and implicit-`any` type errors across services
(e.g. `payment.customerWalletAddress`, `merchant.customFeeRate`,
`catch (err) { err.message }` patterns). Those call sites will need to be
fixed incrementally (nullish checks, explicit typing on catch clauses,
etc.) before this change can compile cleanly in CI. This commit intentionally
does not attempt that codebase-wide migration — it only flips the compiler
flags as requested, per the issue's own suggested incremental approach.
