# Database Index Strategy

This document lists the indexes on the high-traffic tables (`payments`, `settlements`), the query patterns they serve, and how new indexes are added. Schema changes follow [`migrations.md`](./migrations.md).

---

## Indexed query patterns

### `payments`

| Index | Columns | Serves |
|---|---|---|
| `IDX_payments_merchantId` | `(merchantId)` | Merchant-scoped lookups (`payments.service.ts`, `analytics.service.ts`) |
| `IDX_payments_merchantId_status` | `(merchantId, status)` | Merchant payment lists filtered by status |
| `IDX_payments_merchantId_createdAt` | `(merchantId, createdAt)` | Merchant payment history by date |
| `IDX_payments_merchant_created_at` | `(merchantId, createdAt DESC)` | Newest-first merchant payment lists |
| `IDX_payments_merchant_status_created_at` | `(merchantId, status, createdAt)` | Merchant analytics: `status = settled` within a date range |
| `IDX_payments_status` | `(status)` | Status-only filters in admin views |
| `IDX_payments_status_expires_at` | `(status, expiresAt)` | Expiry sweep: `status = pending AND expiresAt < now` (`stellar-monitor.service.ts`) |
| `IDX_payments_created_at` | `(createdAt)` | Cross-merchant date-range filters in admin and dashboard queries |
| `IDX_payments_stellar_memo` | `(stellarMemo)` partial, `WHERE stellarMemo IS NOT NULL` | Memo lookups for incoming Stellar transactions |

### `settlements`

| Index | Columns | Serves |
|---|---|---|
| `IDX_SETTLEMENT_MERCHANT_ID` | `(merchantId)` | Merchant-scoped settlement lists |
| `IDX_SETTLEMENT_STATUS` | `(status)` | Status-only filters in admin views |
| `IDX_SETTLEMENT_MERCHANT_STATUS` | `(merchantId, status)` | Merchant settlement lists filtered by status |

---

## Audit of `WHERE` clauses

Repository and query-builder filters were reviewed in `src/**` (excluding specs and migrations). The table records how each hot pattern is covered:

| Pattern | Location | Covered by |
|---|---|---|
| `payment.merchantId = ?` | `payments.service.ts`, `analytics.service.ts` | `IDX_payments_merchantId` |
| `payment.status = ? AND payment.expiresAt < ?` | `stellar-monitor.service.ts` | `IDX_payments_status_expires_at` |
| `payment.merchantId = ? AND status = ? AND createdAt` range | `analytics.service.ts` | `IDX_payments_merchant_status_created_at` |
| `payment.createdAt` range without merchant | `admin.service.ts` | `IDX_payments_created_at` |
| `settlement.merchantId = ?` | `analytics-export.service.ts`, `settlements.service.ts` | `IDX_SETTLEMENT_MERCHANT_ID` |
| `settlement.status = ?` | `analytics-export.service.ts`, `analytics.service.ts` | `IDX_SETTLEMENT_STATUS` |

---

## Adding an index

1. Add the `@Index` decorator to the entity with an explicit `IDX_*` name, so the entity and migration agree.
2. Add a migration in `src/database/migrations/` with one index per file. Use `CREATE INDEX CONCURRENTLY IF NOT EXISTS` and set `public transaction = false`, so writes are not blocked during the build.
3. Guard with `queryRunner.hasTable(...)` and implement `down()` with `DROP INDEX CONCURRENTLY IF EXISTS`.
4. Run `pnpm migration:check` and `pnpm migration:rollback:check`. CI runs both on any PR that touches migrations or entities.

### Index design rules

- Put equality columns first, then the range or sort column (for example `(merchantId, status, createdAt)`).
- Do not add an index whose leading columns are already covered by an existing one, such as a second `(merchantId)` index.
- Every index adds write cost to `payments`, which is updated on every status transition. Add an index only when a query in the code above needs it.
