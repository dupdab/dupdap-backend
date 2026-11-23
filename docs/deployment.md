# Production Deployment Checklist

## Pre-deploy

- [ ] Verify all CI checks pass on the release branch (lint, unit, e2e).
- [ ] Review pending database migrations; confirm they are zero-downtime safe (expand-contract only).
- [ ] Confirm required secrets/config are present in the production vault (no defaults, no placeholders).
- [ ] Rotate secrets scheduled for rotation (see Secret rotation on deploy).
- [ ] Announce deploy window and freeze non-emergency merges.
- [ ] Snapshot database (automated backup verified within last 24h).
- [ ] Verify WAL archiving is healthy: `archive_mode = on`, no `pg_stat_archiver` failures, and the latest archived segment is recent (see WAL archiving and point-in-time recovery).
- [ ] Verify health probes: `/health` (liveness) and `/health/ready` (readiness, post cache warm-up).

## Deploy

- [ ] Run database migrations before rolling out application instances.
- [ ] Deploy with rolling strategy (maxUnavailable: 0) so old instances serve traffic until new ones are ready.
- [ ] Wait for cache warm-up to complete (check logs for `Cache warm-up completed`) before allowing readiness probes to pass.
- [ ] Verify new instances report `{"status":"ready"}` on `/health/ready`.
- [ ] Smoke-test critical paths: auth, payments, settlements, webhooks, Stellar/Soroban RPC.

## Post-deploy

- [ ] Confirm error rate, latency, and queue depth dashboards are nominal for 30 minutes.
- [ ] Verify Sentry has no new release-tagged issues.
- [ ] Verify Prometheus `admin_alerts_open` and settlement metrics are reporting.
- [ ] Confirm backup job ran successfully after deploy.
- [ ] Confirm WAL archiving is still healthy (`pg_stat_archiver.failed_count` not increasing, `last_archived_time` recent).
- [ ] Announce completion and unfreeze merges.

## Rollback procedure

1. Stop the rollout (`kubectl rollout pause` or equivalent).
2. Roll back to the previous known-good image (`kubectl rollout undo deployment/<name>`).
3. Do NOT roll back database migrations automatically; only the application rolls back. Forward-fix with a new migration if schema changed.
4. Verify `/health/ready` returns 200 on restored instances.
5. Re-run smoke tests and monitor dashboards for 30 minutes.
6. Record incident notes and root cause for the failed deploy.

## Database migration strategy (zero-downtime migrations)

- Use expand-contract: additive changes first (new nullable columns, new enum values with `IF NOT EXISTS`), backfill, then deploy code, then contract (drop old columns) in a later release.
- Never rename/drop columns or change types in the same release that reads/writes them.
- Every migration must be idempotent (`IF NOT EXISTS` / `IF EXISTS`) and reversible or forward-fixable.
- Test migrations against a production-like snapshot in staging before release.
- See `docs/migrations.md` for the expand-contract examples used in this repo.

## Secret rotation on deploy

- Rotate on a schedule and on every deploy that touches auth, webhook, or wallet credentials.
- Steps: generate new secret in vault → deploy with dual-read (accept old + new) where supported → switch writers to new secret → revoke old secret → verify Sentry/auth/webhook error rates unchanged.
- Never commit secrets; verify `git diff` contains no secret values before pushing the release.
- Covered secrets: `ADMIN_ALERT_SLACK_WEBHOOK_URL`, `ZEPTOMAIL_API_KEY`, `STELLAR_ACCOUNT_SECRET`, `DB_PASSWORD`, `REDIS_PASSWORD`, API keys, webhook secrets, partner keys.

## Backup and restore (disaster recovery)

Backups are written to S3 by the scheduled backup job. Restore procedures, RTO/RPO targets, tested-restore timings, and the quarterly drill schedule are documented in `src/backup/RECOVERY_DRILL.md`. Follow that runbook for any disaster-recovery restore; this section only summarizes the deploy-time expectations.

- [ ] Confirm the most recent S3 backup is within the RPO target before declaring a deploy complete.
- [ ] Confirm WAL archiving is healthy so point-in-time recovery is available (see below).
- [ ] After any restore, re-run the smoke tests above and verify `/health/ready` before resuming traffic.

## WAL archiving and point-in-time recovery (PITR)

Daily base backups alone limit recovery granularity to the last backup. To recover to an arbitrary point in time (e.g. just before a bad migration or data corruption), PostgreSQL must continuously archive its write-ahead log (WAL) segments. WAL archiving is required for PITR; without it, RPO is effectively the daily backup interval.

### PostgreSQL configuration

Set the following in `postgresql.conf` (or via `ALTER SYSTEM`) on the primary and restart/reload as noted:

```conf
# Enable WAL archiving. wal_level=replica is the minimum that supports archiving.
wal_level = replica
archive_mode = on

# Push each completed WAL segment to S3. %p = path to segment, %f = segment filename.
# The command must exit 0 only after the segment is durably stored; a non-zero exit
# causes PostgreSQL to retry the segment (it will not recycle it until archived).
archive_command = 'aws s3 cp %p s3://$WAL_ARCHIVE_BUCKET/wal/%f --only-show-errors'

# Force a WAL switch at least every 60s so low-traffic periods still bound RPO.
archive_timeout = 60s

# Keep enough WAL for replicas / crash recovery.
max_wal_senders = 10
wal_keep_size = 1GB
```

Notes:

- `archive_mode` requires a restart; `archive_command` and `archive_timeout` can be reloaded.
- The archiving role needs `s3:PutObject` on `s3://$WAL_ARCHIVE_BUCKET/wal/*`. Prefer an instance role over static keys; never inline credentials in `archive_command`.
- Use a dedicated bucket/prefix per environment (e.g. `prod`, `staging`) and enable S3 versioning + lifecycle rules so WAL is retained at least as long as the base-backup retention window.
- `archive_command` must be idempotent: re-uploading the same `%f` is safe and expected on retry.

### Verifying archiving health

```sql
SELECT archived_count, failed_count, last_archived_wal, last_archived_time, last_failed_wal, last_failed_time
FROM pg_stat_archiver;
```

- `failed_count` must not be increasing; investigate `last_failed_wal` immediately if it is.
- `last_archived_time` should be recent (within `archive_timeout` under load, or shortly after the last write burst).
- Alert if `now() - last_archived_time` exceeds a few minutes, or if `failed_count` increases between scrapes.

### Restore / PITR procedure

1. Restore the most recent base backup to the target data directory (see `src/backup/RECOVERY_DRILL.md`).
2. Configure recovery in `postgresql.conf` (or `postgresql.auto.conf`):

   ```conf
   restore_command = 'aws s3 cp s3://$WAL_ARCHIVE_BUCKET/wal/%f %p --only-show-errors'
   recovery_target_time = '2024-01-01 12:00:00+00'   # desired point in time
   recovery_target_action = 'promote'
   ```

3. Start PostgreSQL; it replays archived WAL up to `recovery_target_time`, then promotes.
4. Verify data integrity, re-run smoke tests, and confirm `/health/ready` before resuming traffic.

### Recovery drill (updated for WAL-based PITR)

The quarterly drill in `src/backup/RECOVERY_DRILL.md` must now exercise WAL-based PITR, not just base-backup restore:

- [ ] Restore the latest base backup into an isolated environment.
- [ ] Apply archived WAL via `restore_command` and recover to a chosen `recovery_target_time` (e.g. 5 minutes before a simulated incident).
- [ ] Confirm the recovered database reflects writes up to the target time and excludes later writes.
- [ ] Record measured RTO and the achieved RPO (time between target and last archived WAL).
- [ ] Verify `pg_stat_archiver` shows no failures and that WAL segments exist in S3 for the full retention window.
- [ ] Update the drill log with timings and any gaps found.
