# Query Plans

Review of the list queries in `scripts/explain-list-queries.ts`. Run with:

```bash
npm run explain:queries
```

Connection settings come from `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` (or `DB_PASS`), and `DB_NAME`.

## Status

- **Index review: done.** Each query below was checked against the indexes defined in the migrations.
- **Live `EXPLAIN ANALYZE` output: not yet captured.** The review was done from the schema, not against a database with production-sized data. Re-run `npm run explain:queries` against staging or a production replica and paste the output into the "Captured output" section of this file.
- **Sequential scans on large tables: none expected from the indexes below.** This must be confirmed by the live run before it is treated as closed.

## Queries

### `payments_paginated_by_merchant_created_at`

```sql
SELECT * FROM payments WHERE "merchantId" = $1 ORDER BY "createdAt" DESC LIMIT 20 OFFSET 0
```

- Index: `IDX_payments_merchant_created_at` on `("merchantId", "createdAt" DESC)` (`1772200000011-AddQueryPerformanceIndexes.ts`).
- Expected plan: `Index Scan using IDX_payments_merchant_created_at`, with no separate sort node.
- Risk: `findAll` paginates with `OFFSET`, so cost grows with page depth. Deep pages will scan and discard rows. Keyset pagination on `("createdAt", "id")` would fix this if pages beyond a few hundred are reached in practice.

### `payments_monitor_lookup_by_memo`

```sql
SELECT * FROM payments WHERE status = 'pending' AND "stellarMemo" = $1 LIMIT 1
```

- Index: `IDX_payments_stellar_memo` on `("stellarMemo") WHERE "stellarMemo" IS NOT NULL` (partial).
- Expected plan: `Index Scan using IDX_payments_stellar_memo`, with `status` applied as a filter on the matching rows.
- Memo values are expected to match few rows, so the `status` filter is cheap. No new index is needed.

### `payments_pending_for_cron`

```sql
SELECT * FROM payments WHERE status = 'pending' LIMIT 200
```

- Index: `IDX_payments_status` on `("status")`.
- Expected plan: `Bitmap Heap Scan` or `Index Scan using IDX_payments_status`, limited to 200 rows.
- Risk: if most payments are `pending`, the planner may choose a sequential scan. Confirm the row distribution in the live run. A partial index `WHERE status = 'pending'` would be the fix.

### `settlements_by_merchant_and_status`

```sql
SELECT * FROM settlements WHERE "merchantId" = $1 AND status = $2 ORDER BY "createdAt" DESC LIMIT 20
```

- Index: `IDX_settlements_merchant_status` on `("merchantId", "status")`, plus `IDX_SETTLEMENT_MERCHANT_STATUS` from `1772400000000-BackfillMissingEntityIndexes.ts`.
- Expected plan: index scan on `(merchantId, status)`, then a top-N sort on `createdAt`.
- Candidate follow-up: `("merchantId", "status", "createdAt" DESC)` would remove the sort. Only add it if the live run shows the sort is significant for a merchant with many settlements.

## Monitoring: `pg_stat_statements`

Migration `1772400000003-EnablePgStatStatements.ts` runs `CREATE EXTENSION IF NOT EXISTS pg_stat_statements`.

The extension only collects statistics when the server preloads it. Set this in the Postgres server configuration and restart:

```
shared_preload_libraries = 'pg_stat_statements'
```

Then check the top queries by total time:

```sql
SELECT calls, total_exec_time, mean_exec_time, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

On managed Postgres, enable the extension through the provider's settings instead of editing the config file directly.

## Captured output

Not yet captured. Paste the `EXPLAIN ANALYZE` output for each query here, dated and tagged with the environment it was run against.
