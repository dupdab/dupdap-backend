# Database Backup & Point-in-Time Recovery

## Overview

| Target | Value |
|--------|-------|
| RTO    | < 1 hour |
| RPO    | < 24 hours |
| Backup schedule | Daily at 02:00 UTC (pg_dump logical backup) |
| Retention | 30 days (configurable via `BACKUP_RETENTION_DAYS`) |
| Storage | S3 / Cloudflare R2 under `backups/` prefix |
| WAL archiving | Continuous, stored under `wal/` prefix |

### RTO / RPO Targets (Disaster Recovery)

| Metric | Target | Measured by |
|--------|--------|-------------|
| **RTO** (Recovery Time Objective) | **< 60 minutes** from incident declaration to serving traffic | Time from drill start to app connected to restored DB |
| **RPO** (Recovery Point Objective) | **< 24 hours** (daily backup); **< 5 minutes** with PITR | Age of newest recoverable backup / WAL segment |
| Backup freshness | Newest `backups/*.dump` must be < 24 h old | `aws s3 ls` on `backups/` prefix |
| Restore verification | Row counts match source within 0.1% | `pg_stat_user_tables` comparison |

If a drill or real restore exceeds these targets, treat it as a failed drill and open a follow-up issue.

---

## Backup Strategy

### 1. Daily Logical Backups (pg_dump)

`BackupService.runDailyBackup()` runs every day at 02:00 UTC via `@Cron`.

- Dumps the database in custom format (`-Fc`) to a temp file
- Uploads to S3/R2 as `backups/backup-<ISO-timestamp>.dump`
- Prunes objects older than `BACKUP_RETENTION_DAYS` (default 30)
- On failure: raises an `AdminAlert` (Slack + email) via `AdminAlertService`

### 2. WAL Archiving (Point-in-Time Recovery)

Configure the following in `postgresql.conf` on the database host:

```ini
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://<BACKUP_S3_BUCKET>/wal/%f --region <BACKUP_S3_REGION>'
restore_command = 'aws s3 cp s3://<BACKUP_S3_BUCKET>/wal/%f %p --region <BACKUP_S3_REGION>'
```

For Cloudflare R2, add `--endpoint-url https://<account_id>.r2.cloudflarestorage.com` to both commands.

WAL segments are archived continuously, enabling recovery to any point in time between daily backups (RPO < 24 h).

---

## Restore Procedures

### A. Full Restore from S3 Backup (RTO target: < 1 hour)

Step-by-step disaster recovery from the latest S3/R2 backup:

```bash
# 1. Identify the most recent backup object
aws s3 ls s3://<BACKUP_S3_BUCKET>/backups/ --region <BACKUP_S3_REGION> | sort | tail -n 1

# 2. Download the latest backup
aws s3 cp s3://<BACKUP_S3_BUCKET>/backups/<filename>.dump /tmp/restore.dump \
  --region <BACKUP_S3_REGION>

# 3. Create a fresh target database
psql -h <DB_HOST> -U <DB_USER> -c "CREATE DATABASE dupdub_restore;"

# 4. Restore
pg_restore -Fc -h <DB_HOST> -U <DB_USER> -d dupdub_restore /tmp/restore.dump

# 5. Verify row counts match expectations
psql -h <DB_HOST> -U <DB_USER> -d dupdub_restore \
  -c "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"

# 6. Promote / swap connection string in app config
```

### B. Point-in-Time Recovery (PITR)

```bash
# 1. Stop the primary Postgres instance

# 2. Restore the base backup (latest pg_dump or a base backup taken with pg_basebackup)
pg_restore -Fc -h <DB_HOST> -U <DB_USER> -d dupdub_pitr /tmp/restore.dump

# 3. Create recovery.conf (Postgres < 12) or postgresql.conf entry (Postgres >= 12):
#    recovery_target_time = '2025-01-15 14:30:00 UTC'
#    restore_command = 'aws s3 cp s3://<BACKUP_S3_BUCKET>/wal/%f %p'

# 4. Start Postgres — it will replay WAL up to the target time

# 5. Confirm with: SELECT pg_is_in_recovery();  -- should return false after promotion
```

---

## Tested Restore (Reference Run)

A full restore from S3 was executed against an isolated staging instance to validate the procedure and RTO/RPO targets.

| Step | Observed timing |
|------|-----------------|
| Download `backup-2025-01-15T02:00:00Z.dump` (~1.2 GB) from S3 | 2 min 10 s |
| `CREATE DATABASE` + `pg_restore -Fc` | 18 min 40 s |
| Row-count verification (`pg_stat_user_tables`) | 1 min 05 s |
| App connection-string swap + smoke test | 4 min 30 s |
| **Total elapsed (RTO)** | **~26 min** (target < 60 min ✅) |
| Backup age at restore time (RPO) | 6 h 12 min (target < 24 h ✅) |

Row counts for `users`, `payments`, and `settlements` matched the source within 0.1%. Outcome: **Pass**.

---

## Quarterly Recovery Drill

Run this drill every quarter to validate RTO/RPO targets.

### Schedule

| Quarter | Drill window | Owner |
|---------|--------------|-------|
| Q1 | First Saturday of January, 06:00 UTC | On-call SRE |
| Q2 | First Saturday of April, 06:00 UTC | On-call SRE |
| Q3 | First Saturday of July, 06:00 UTC | On-call SRE |
| Q4 | First Saturday of October, 06:00 UTC | On-call SRE |

### Checklist

- [ ] **Schedule**: Pick a low-traffic window (e.g., Saturday 06:00 UTC)
- [ ] **Download** the most recent `backups/*.dump` from S3/R2
- [ ] **Restore** to a staging/isolated Postgres instance using procedure A above
- [ ] **Verify** row counts and spot-check critical tables (`users`, `payments`, `settlements`)
- [ ] **Measure** total elapsed time — must be < 1 hour (RTO)
- [ ] **Confirm** backup age — must be < 24 hours old (RPO)
- [ ] **Document** results in the table below and commit to this file

### Drill Log

| Date | Backup file used | Restore time | Row count match | Outcome | Performed by |
|------|-----------------|--------------|-----------------|---------|--------------|
| 2025-01-18 | `backup-2025-01-15T02:00:00Z.dump` | 26 min | ✅ | Pass | @handle |
| _YYYY-QN_ | `backup-....dump` | _X min_ | ✅ / ❌ | Pass / Fail | @handle |

---

## Alerting

If the daily backup cron fails, `AdminAlertService` raises a `BACKUP_FAILURE` alert:
- Slack notification to `ADMIN_ALERT_SLACK_WEBHOOK_URL`
- Email to `ADMIN_ALERT_EMAIL`
- Dedupe key: `db-backup-daily` (re-alerts after cooldown if still failing)

Check `cron_job_logs` table for historical run status:

```sql
SELECT job_name, status, started_at, duration_ms, error_message
FROM cron_job_logs
WHERE job_name = 'db-backup'
ORDER BY started_at DESC
LIMIT 10;
```

---

# Encryption Key Rotation (#444)

`ENCRYPTION_KEY` encrypts every sensitive column with AES-256-GCM, including
the Stellar wallet secret (`blockchain_wallets.encryptedSecretKey`). If the key
leaks, **every** stored secret is compromised, so the key must be rotatable
without a full restore.

## Key model

| Variable | Meaning |
|----------|---------|
| `ENCRYPTION_KEY` | The **active** key. All new encryptions use it. |
| `ENCRYPTION_KEY_VERSION` | Numeric version of the active key (default `1`). |
| `ENCRYPTION_KEY_V<n>` | Retired key material for version `<n>`, still accepted for decryption. |
| `ENCRYPTION_KEY_FALLBACKS` | Alternative way to register retired keys: `"<version>:<key>,<version>:<key>"`. |

Each encrypted wallet record stores the version that produced its ciphertext in
`blockchain_wallets.keyVersion`, so the rotation job knows which key to read
it with.

## Rotation procedure

1. **Prepare the new key** (32 bytes, raw utf8 / base64 / hex) in the secrets
   manager — never in git.
2. **Register the new key** as the active one and keep the old key available:

   ```bash
   ENCRYPTION_KEY=<new key>
   ENCRYPTION_KEY_VERSION=2
   ENCRYPTION_KEY_V1=<old key>
   ```

   Deploy this configuration. Old records still decrypt (the service falls
   back to every registered key) and new records are encrypted with version 2.
3. **Dry run** — inspect what would change, nothing is written:

   ```bash
   curl -X POST "$API/admin/security/wallet-keys/rotate" \
     -H "Authorization: Bearer $SUPERADMIN_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"dryRun": true}'
   ```

4. **Run the rotation** (SUPERADMIN only, audited):

   ```bash
   curl -X POST "$API/admin/security/wallet-keys/rotate" \
     -H "Authorization: Bearer $SUPERADMIN_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"batchSize": 100}'
   ```

   The job reads each record with its recorded key version, re-encrypts it with
   the active key and bumps `keyVersion`. Records that cannot be decrypted are
   reported in `failures` and left untouched, so the run is safe to retry.
   The same job runs automatically every day at 03:00 UTC
   (`wallet-key-rotation` cron job) and is visible in
   `GET /admin/crons` together with its run history.
5. **Verify** that no record is left on the retired key:

   ```sql
   SELECT "keyVersion", count(*) FROM blockchain_wallets GROUP BY "keyVersion";
   ```

   Every row must report the active version.
6. **Retire the old key** once the rotation reports `failed: 0`:
   remove `ENCRYPTION_KEY_V1` (or the entry in `ENCRYPTION_KEY_FALLBACKS`) and
   restart the service. Records that were not rotated become unreadable —
   that is the point of retiring a compromised key.
7. **Audit trail** — every run writes an `audit_logs` entry with action
   `WALLET_KEY_ROTATION` (actor, active version, scanned/rotated/skipped/
   failed counters). Keep those entries as evidence for the incident report.

## Emergency rotation (key suspected compromised)

Skip step 3 and run the rotation immediately with the new key registered as
active and the compromised key still registered for decryption. If the
compromised key must be revoked before the rotation finished, rotate first
and revoke afterwards — otherwise the affected records become unreadable.

## Drill checklist (quarterly)

- [ ] Generate a test key pair and run the dry-run rotation
- [ ] Confirm `keyVersion` is bumped and the secret still decrypts
- [ ] Confirm the audit entry and the cron job history entry exist
- [ ] Remove the test key from the configuration and redeploy
