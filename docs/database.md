# Database

This document describes the database schema, materialized views, and refresh scheduling used by the analytics layer.

## Tables

- `payments` — raw payment records (one row per charge).
- `merchants` — merchant accounts.
- `refunds` — refund records linked to payments.

## Materialized views

### `daily_payment_volume`

Aggregates payment volume per merchant per day. Daily analytics queries read from this view instead of scanning `payments` directly.

```sql
CREATE MATERIALIZED VIEW daily_payment_volume AS
SELECT
    merchant_id,
    date_trunc('day', created_at) AS day,
    COUNT(*)                     AS payment_count,
    SUM(amount)                  AS total_amount
FROM payments
GROUP BY merchant_id, date_trunc('day', created_at);

CREATE UNIQUE INDEX daily_payment_volume_pkey
    ON daily_payment_volume (merchant_id, day);
```

### `monthly_payment_volume`

Aggregates payment volume per merchant per month. Monthly analytics queries read from this view instead of scanning `payments` directly, which is prohibitively slow for high-volume merchants.

```sql
CREATE MATERIALIZED VIEW monthly_payment_volume AS
SELECT
    merchant_id,
    date_trunc('month', created_at) AS month,
    COUNT(*)                        AS payment_count,
    SUM(amount)                     AS total_amount
FROM payments
GROUP BY merchant_id, date_trunc('month', created_at);

CREATE UNIQUE INDEX monthly_payment_volume_pkey
    ON monthly_payment_volume (merchant_id, month);
```

## Refresh scheduling

Both materialized views are refreshed daily. The refresh runs after the daily aggregation job and uses `REFRESH MATERIALIZED VIEW CONCURRENTLY` (enabled by the unique indexes above) so reads are not blocked during refresh.

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_payment_volume;
REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_payment_volume;
```

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

Schedule these statements in the same daily job that refreshes `daily_payment_volume`.
