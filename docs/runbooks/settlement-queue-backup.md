# Settlement queue backup

## Symptoms

- Pending settlements age beyond their normal processing window.
- The settlement queue has a growing waiting or delayed count, or workers show sustained failures.
- Merchants report missing fiat payouts.

## Likely root causes

- Settlement workers are stopped, under-provisioned, or blocked by repeated retries.
- The partner API is unavailable or rejecting requests.
- Redis connectivity or queue state is unhealthy.
- Invalid settlement configuration or credentials cause jobs to fail consistently.

## Remediation

1. Inspect the settlement queue metrics and failed jobs through the admin queue endpoints; identify the oldest job and common failure reason.
2. Check worker health, Redis readiness, and partner API status before retrying jobs.
3. Correct credentials or settlement configuration, then restore or scale workers as needed.
4. Retry failed jobs in controlled batches and confirm queue depth falls and settlements reach a terminal state.
5. Reconcile retried payouts with the partner before replaying ambiguous requests to avoid duplicate transfers.

## Escalation

Escalate to Payments Operations for aged payouts or possible duplicate transfers. Include oldest job age, queue counts, settlement IDs, partner responses, and retry actions.

## PostgreSQL WAL archiving (point-in-time recovery)

Daily base backups alone limit recovery to the last backup. To reach point-in-time
recovery (PITR) granularity, PostgreSQL must continuously archive WAL segments to
S3. Configure the primary with the settings below (e.g. in `postgresql.conf` or
via `ALTER SYSTEM`), then restart the server so `archive_mode` takes effect.

```conf
# postgresql.conf
wal_level = replica              # required for WAL archiving
archive_mode = on                # enable WAL archiving (needs restart)
archive_timeout = 60             # force a segment switch at least every 60s

# Push each completed WAL segment to S3. %p = path to segment, %f = filename.
# The bucket must be versioned and have lifecycle rules that retain segments
# for at least the base-backup retention window.
archive_command = 'aws s3 cp %p s3://${WAL_ARCHIVE_BUCKET}/wal/%f --only-show-errors'
```

Notes:

- `archive_command` must exit non-zero on failure so PostgreSQL retries the
  segment; do not append `|| true`.
- Keep `wal_level = replica` (or `logical` if logical replication is used);
  `minimal` disables the WAL needed for PITR.
- Monitor `pg_stat_archiver`: a growing `failed_count` or a stale
  `last_archived_time` means archiving is broken and PITR is at risk.
- Take a base backup (`pg_basebackup`) on the same schedule as before; WAL
  archiving extends, but does not replace, base backups.

## Recovery drill (WAL-based PITR)

1. Confirm the latest base backup and the WAL segments after it are present in
   `s3://${WAL_ARCHIVE_BUCKET}` (base backup prefix and `wal/` prefix).
2. Restore the base backup into a scratch instance, then configure recovery to
   pull WAL from S3:

   ```conf
   restore_command = 'aws s3 cp s3://${WAL_ARCHIVE_BUCKET}/wal/%f %p --only-show-errors'
   recovery_target_time = '2024-01-01 12:00:00+00'   # target point in time
   recovery_target_action = 'promote'
   ```

3. Start the instance and let it replay WAL up to `recovery_target_time`; verify
   the log reports recovery stopping at the requested target.
4. Validate settlement and payment rows against the expected state at that
   timestamp, then promote the instance.
5. Record the drill outcome (target time, segments replayed, validation result)
   and confirm `pg_stat_archiver` shows healthy archiving on the primary.
