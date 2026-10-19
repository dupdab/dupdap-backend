# Production Deployment Checklist

## Pre-deploy

- [ ] Verify all CI checks pass on the release branch (lint, unit, e2e).
- [ ] Review pending database migrations; confirm they are zero-downtime safe (expand-contract only).
- [ ] Confirm required secrets/config are present in the production vault (no defaults, no placeholders).
- [ ] Rotate secrets scheduled for rotation (see Secret rotation on deploy).
- [ ] Announce deploy window and freeze non-emergency merges.
- [ ] Snapshot database (automated backup verified within last 24h).
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
