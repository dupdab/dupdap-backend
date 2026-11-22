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

---

## Point-in-time recovery (WAL archiving)

Daily base backups alone limit recovery to the last backup. To recover to an arbitrary point (for example, just before a bad migration), PostgreSQL must continuously archive its write-ahead log (WAL). The settings below enable WAL archiving and push segments to S3.

### Required `postgresql.conf` settings

```conf
# Enable WAL archiving for PITR.
wal_level = replica
archive_mode = on

# Push each completed WAL segment to S3. %p is the segment path, %f the filename.
archive_command = 'aws s3 cp %p s3://$WAL_BUCKET/wal/%f --only-show-errors'

# Force a segment switch so low-traffic periods still produce archived WAL.
archive_timeout = 60

# Used during recovery to fetch archived segments from S3.
restore_command = 'aws s3 cp s3://$WAL_BUCKET/wal/%f %p --only-show-errors'
```

Notes:

- `wal_level` must be `replica` or higher; `archive_mode` requires a restart to take effect.
- `archive_command` must exit `0` only when the segment is durably stored. `aws s3 cp` returns non-zero on failure, so PostgreSQL retries the segment.
- Set `WAL_BUCKET` (and AWS credentials/region) in the database host environment. Grant the instance role `s3:PutObject` on `s3://$WAL_BUCKET/wal/*` and `s3:GetObject` for restores.
- Keep `archive_timeout` low enough that the recovery point objective (RPO) is met; 60s bounds the unarchived window.
- Verify archiving with `SELECT * FROM pg_stat_archiver;` — `failed_count` should stay at `0` and `last_archived_time` should advance.

### Recovery drill procedure

Run this drill quarterly against a scratch instance to confirm WAL-based PITR works end to end.

1. **Confirm archiving is healthy.** On production, check `pg_stat_archiver`: `failed_count = 0` and `last_archived_time` is recent. List a few segments: `aws s3 ls s3://$WAL_BUCKET/wal/ | tail`.
2. **Restore the base backup.** Provision a scratch instance and restore the latest base backup into its data directory.
3. **Configure recovery.** In `postgresql.auto.conf` (or `recovery.conf` on older versions) set `restore_command` as above and a target time:
   ```conf
   restore_command = 'aws s3 cp s3://$WAL_BUCKET/wal/%f %p --only-show-errors'
   recovery_target_time = '2024-01-01 12:00:00+00'
   recovery_target_action = 'promote'
   ```
4. **Start and replay.** Start PostgreSQL; it replays archived WAL up to `recovery_target_time`, then promotes. Watch the log for `archive recovery complete`.
5. **Validate.** Run a known query (for example, a payment created just before the target time) and confirm the row exists while later changes do not. Record the achieved RPO (time between target and last archived segment).
6. **Record results.** Note the drill date, target time, achieved RPO, and any `pg_stat_archiver` failures in the ops runbook. Investigate any `failed_count > 0` before the next drill.
