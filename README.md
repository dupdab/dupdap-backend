# DupDub Backend

[![CI](https://github.com/dupdub/dupdub-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/dupdub/dupdub-backend/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/dupdub/dupdub-backend/branch/main/graph/badge.svg)](https://codecov.io/gh/dupdub/dupdub-backend)

> Crypto-to-fiat settlement API — merchants accept USDC on Stellar, customers pay from a wallet, and the platform settles fiat to the merchant's bank account.

This is the backend service for the DupDub payment platform. It exposes a REST API (NestJS), watches the Stellar network for incoming payments, drives the payment/settlement lifecycle, and talks to the on-chain Soroban contracts that hold funds in escrow.

Related repos:

- [`dupdap-frontend`](../dupdap-frontend) — merchant dashboard & customer payment portal (Next.js)
- [`dupdapp_stellar`](../dupdapp_stellar) — the Soroban smart contracts (`payment_escrow`, `merchant_registry`, `settlement_ledger`, etc.) this service reads from and writes to

## Why Stellar

This service is built Stellar-native, not multi-chain:

- **Fast finality** — ~5 second ledger close times mean a customer payment can be confirmed and reflected in the merchant dashboard almost immediately, instead of waiting on multiple block confirmations.
- **Low, predictable fees** — base fees are fractions of a cent, which matters for a settlement platform that needs to be viable on small transactions.
- **Native asset issuance + SEP-41** — USDC on Stellar is a first-class asset, and SEP-41 gives a standard token-contract interface that Soroban can monitor for transfer events, rather than relying on custom ERC-20-style event parsing.
- **Soroban smart contracts for escrow** — the `payment_escrow` contract (see [`dupdapp_stellar`](../dupdapp_stellar)) holds customer funds until settlement conditions are met, giving the platform an on-chain, auditable escrow step instead of trusting a hot wallet alone.
- **Purpose-built for cross-border remittance** — Stellar's anchor/asset-issuance model was designed for moving value between fiat rails, which lines up with this platform's crypto-in, fiat-out settlement flow.

## Architecture

### How a payment flows through the system

```
Merchant creates payment request (POST /api/v1/payments)
        │
        ▼
Customer approves + deposits USDC into the payment_escrow
Soroban contract (via frontend + Stellar wallet)
        │
        ▼
StellarMonitorService polls Horizon (deposit address) every 30s
SorobanEventIndexerService watches Soroban RPC for contract events
        │
        ▼
Payment confirmed → dispatch `payment.confirmed` webhook
        │
        ▼
SettlementsService converts crypto → fiat via the partner
liquidity provider API, dispatches `payment.settling`
        │
        ▼
Partner settlement callback (POST /settlements/partner-callback)
        │
        ▼
`payment.settled` (or `payment.failed`) webhook dispatched,
merchant sees the settlement in the dashboard
```

### Module layout (`src/`)

| Module                                                        | Responsibility                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `payments/`, `payment/`                                       | Payment request lifecycle, QR codes, receipts, batch payments                                                             |
| `stellar/`                                                    | Horizon polling (`StellarMonitorService`), Soroban event indexing, `StellarService` (SDK wrapper, `invokeContract`)       |
| `soroban/`                                                    | Lower-level Soroban RPC client used by wallet provisioning and contract calls                                             |
| `blockchain-wallet/`                                          | Server-side Stellar keypair provisioning per user (AES-256-GCM encrypted secret storage), balance sync, slippage handling |
| `settlements/`                                                | Crypto→fiat settlement orchestration, partner callback handling                                                           |
| `merchants/`                                                  | Merchant profile, API key issuance/scoping, notification preferences                                                      |
| `webhooks/`                                                   | Webhook registration, signed delivery, retry/backoff, failure alerting                                                    |
| `waitlist/`                                                   | Public waitlist signup/lookup/stats                                                                                       |
| `auth/`                                                       | Registration/login, JWT + API key guards                                                                                  |
| `admin/`                                                      | Internal admin operations and reporting                                                                                   |
| `analytics/`                                                  | Merchant-facing and platform-wide analytics                                                                               |
| `aml/`                                                        | Anti-money-laundering checks                                                                                              |
| `groups/`                                                     | Merchant grouping/org structures                                                                                          |
| `notifications/`, `email/`                                    | Notification preferences and email delivery (SMTP/SendGrid)                                                               |
| `queues/`, `retry/`                                           | Bull/Redis queue definitions and per-queue retry policies                                                                 |
| `cache/`                                                      | Redis-backed caching (requires a reachable Redis instance)                                                                |
| `cron/`                                                       | Scheduled jobs                                                                                                            |
| `backup/`                                                     | Database backup to S3                                                                                                     |
| `audit/`                                                      | Audit logging for compliance                                                                                              |
| `security/`                                                   | Security-related guards/utilities                                                                                         |
| `prometheus/`, `sentry/`, `telemetry/`                        | Metrics export, error tracking, OpenTelemetry tracing                                                                     |
| `health/`                                                     | Liveness/readiness endpoints                                                                                              |
| `common/`, `core/`, `config/`, `database/`, `runtime-config/` | Shared interceptors/filters, TypeORM setup + migrations, config loading                                                   |

### Data flow at a glance

Postgres (via TypeORM) is the system of record for payments, merchants, settlements, and webhooks. Redis backs both the cache layer and the Bull job queues (Stellar monitoring, webhook delivery, settlement retries, email). Stellar Horizon + Soroban RPC are the only blockchain dependencies — there is no EVM/ethers.js integration in this codebase today.

## Tech stack

- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL + TypeORM (migration-based schema management)
- **Queues/Cache**: Redis via Bull (jobs) and `@nestjs/cache-manager`
- **Blockchain**: `@stellar/stellar-sdk` — Horizon for classic-asset payments, Soroban RPC for contract calls/events
- **Auth**: JWT (`@nestjs/jwt`/passport) and scoped API keys
- **API docs**: `@nestjs/swagger` (OpenAPI), served at `/docs`
- **Observability**: Prometheus metrics, Sentry error tracking, OpenTelemetry tracing, Winston structured logging
- **Email**: Nodemailer over SMTP or SendGrid

## Getting started

### Prerequisites

- Node.js 20+ and pnpm (CI uses pnpm 10; npm also works for local dev)
- PostgreSQL 16+
- Redis 6+
- (recommended) Docker + Docker Compose — runs PostgreSQL 16 and Redis 6 for you

### Setup with Docker Compose (recommended)

```bash
# Start PostgreSQL 16 + Redis 6 (+ Adminer DB UI)
docker compose up -d

# Set up environment variables (defaults already match the Compose services)
cp .env.example .env

# Run database migrations
pnpm migration:run

# Start development server
pnpm start:dev
```

- Adminer DB UI: http://localhost:8080 (server: `postgres`, user: `postgres`, password: `postgres`, database: `dupdub`)
- Test database: `docker compose -f docker-compose.test.yml up -d` (Postgres on `:5433`, DB `dupdub_test`, Redis on `:6380`)

### Setup (manual services)

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration — see below

# Run database migrations
pnpm migration:run

# Start development server
pnpm start:dev

# Run tests
pnpm test
pnpm test:e2e
```

Once running, the API is at `http://localhost:3000/api/v1` and interactive API docs (Swagger UI) are at `http://localhost:3000/docs`.

### Useful scripts

| Script                                                                              | Purpose                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------- |
| `pnpm migration:generate` / `migration:run` / `migration:revert` / `migration:show` | TypeORM migrations                          |
| `pnpm db:seed` / `db:seed:test` / `db:reset`                                        | Local DB seeding/reset                      |
| `pnpm migration:check` / `migration:rollback:check` / `migration:uncommitted:check` | CI safety checks on migrations              |
| `pnpm test:cov`                                                                     | Unit tests with coverage                    |
| `pnpm test:integration`                                                             | Integration specs (`*.integration-spec.ts`) |
| `pnpm test:e2e`                                                                     | End-to-end specs (`*.e2e-spec.ts`)          |
| `pnpm explain:queries`                                                              | Run `EXPLAIN` on the list/query endpoints   |

## Environment variables

Full list lives in [`.env.example`](.env.example); the categories below cover what each group is for.

#### Server & CORS

```bash
PORT=3000
API_PREFIX=api/v1
NODE_ENV=development
ALLOWED_ORIGINS=https://app.dupdub.xyz,https://dupdub.xyz   # comma-separated, production only
```

#### Database

```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_NAME=dupdub
DB_POOL_MIN=2
DB_POOL_MAX=20
DB_ACQUIRE_TIMEOUT_MS=10000
DB_IDLE_TIMEOUT_MS=60000
```

#### Auth

```bash
JWT_SECRET=your_jwt_secret_key_min_32_chars
JWT_EXPIRES_IN=7d
API_KEY_SALT=your_api_key_salt
```

#### Stellar / Soroban

```bash
STELLAR_NETWORK=TESTNET

See [Stellar Configuration](#stellar-configuration) below for the full variable reference and testnet/mainnet setup.

## Stellar Configuration

The service talks to Stellar through two endpoints: Horizon (classic operations, payment monitoring) and Soroban RPC (escrow contract calls and SEP-41 event polling). `STELLAR_NETWORK` selects the network and drives the defaults for everything else.

### Variables

Defaults shown are the values used when the variable is unset. "—" means no default: the variable is optional or must be provided.

| Variable | Default | Description |
|---|---|---|
| `STELLAR_NETWORK` | `TESTNET` | `TESTNET` or `PUBLIC`. Selects the network passphrase and the default Horizon URL. |
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` (`https://horizon.stellar.org` when `STELLAR_NETWORK=PUBLIC`) | Horizon REST endpoint for classic payments and account lookups. |
| `STELLAR_ACCOUNT_SECRET` | — | Secret key (`S...`) of the platform account. Used to sign transactions; the service fails to send transactions without it. Never commit. |
| `STELLAR_ACCOUNT_PUBLIC` | derived from `STELLAR_ACCOUNT_SECRET` | Public key (`G...`) of the platform deposit account. |
| `STELLAR_USDC_ISSUER` | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | Issuer of the classic USDC asset. Override with the mainnet issuer for `PUBLIC`. |
| `STELLAR_USDC_CONTRACT_ID` | — | SEP-41 USDC token contract ID (`C...`) for Soroban event monitoring. Blank disables the Soroban fallback monitor. |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint. **Required**: the Soroban module refuses to start without it. |
| `SOROBAN_NETWORK_PASSPHRASE` | derived from `STELLAR_NETWORK` | Explicit network passphrase. Leave blank unless you need a custom network; if blank and `STELLAR_NETWORK` is neither `TESTNET` nor `PUBLIC`, the passphrase is fetched from the RPC. |
| `SOROBAN_SOURCE_SECRET` | `STELLAR_ACCOUNT_SECRET` | Secret key that signs Soroban contract invocations. Set separately to use a different source account. |
| `SOROBAN_SOURCE_PUBLIC_KEY` | `STELLAR_ACCOUNT_PUBLIC` | Public key matching `SOROBAN_SOURCE_SECRET`. |
| `SOROBAN_CONTRACT_ID` | — | `payment_escrow` contract ID (`C...`) called by `invokeContract()`. Also used by the Soroban event indexer. |
| `SOROBAN_ESCROW_CONTRACT_ID` | — | Escrow contract ID polled by the Soroban monitor for state-transition events. Blank skips the poll. |
| `SOROBAN_ESCROW_CONTRACT_ID_TESTNET` | — | Written by the `dupdapp_stellar` deploy script. Not read by this service; copy the active value into `SOROBAN_ESCROW_CONTRACT_ID`. |
| `SOROBAN_ESCROW_CONTRACT_ID_MAINNET` | — | Same as above, for mainnet. |
| `ENCRYPTION_KEY` | — | 32-byte key (raw UTF-8, base64, or hex) used to encrypt per-user Stellar wallet secrets at rest. Required for wallet provisioning. |

### Testnet setup

1. **Keep the testnet defaults.** `STELLAR_NETWORK=TESTNET` is the default; the Horizon and Soroban RPC defaults already point at testnet.
2. **Generate a platform keypair.** Either use the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) (`stellar keys generate --network testnet`) or `Keypair.random()` from `@stellar/stellar-sdk`. Put the secret in `STELLAR_ACCOUNT_SECRET` and the public key in `STELLAR_ACCOUNT_PUBLIC`.
3. **Fund the account with the testnet faucet (Friendbot).** Accounts must be funded with XLM before they can send transactions:
   ```bash
   curl "https://friendbot.stellar.org/?addr=GXXX..."
   ```
4. **Get testnet USDC.** Add a USDC trustline to the account (`STELLAR_USDC_ISSUER`), then request testnet USDC from the [Circle testnet faucet](https://faucet.circle.com) (select Stellar).
5. **Deploy the escrow contract.** Deploy `payment_escrow` from [`dupdapp_stellar`](../dupdapp_stellar) following that repo's README. Copy the printed contract ID into `SOROBAN_CONTRACT_ID` and `SOROBAN_ESCROW_CONTRACT_ID`.
6. **Start the service** and check `GET /health/ready`. The Horizon check confirms the endpoint is reachable.

### Mainnet

Set `STELLAR_NETWORK=PUBLIC` and provide mainnet values explicitly rather than relying on the testnet defaults:

- `STELLAR_HORIZON_URL` (or leave unset to use `https://horizon.stellar.org`)
- `SOROBAN_RPC_URL`: a mainnet Soroban RPC endpoint from your provider
- `STELLAR_USDC_ISSUER`: the mainnet USDC issuer
- `STELLAR_USDC_CONTRACT_ID` and `SOROBAN_CONTRACT_ID` / `SOROBAN_ESCROW_CONTRACT_ID`: the mainnet contract IDs from your `dupdapp_stellar` deployment
- A funded mainnet platform account (`STELLAR_ACCOUNT_SECRET`)

Contract deployment is handled in [`dupdapp_stellar`](../dupdapp_stellar), which owns the Soroban contracts (`payment_escrow`, `merchant_registry`, `settlement_ledger`) and the deploy scripts that print the contract IDs.

#### Fiat settlement partner

```bash
PARTNER_API_URL=https://partner-api.example.com/v1
PARTNER_API_KEY=your_partner_api_key
PARTNER_WEBHOOK_SECRET=your_partner_webhook_secret
```

#### Webhooks (outbound, to merchants)

```bash
WEBHOOK_SECRET=your_webhook_signing_secret
WEBHOOK_RETRY_COUNT=5
WEBHOOK_RETRY_DELAYS_MS=60000,300000,1800000,7200000,43200000
```

#### Queues & retries (Bull/Redis)

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
CACHE_VERSION=v1                    # Optional release identifier (for example, the deployed git SHA)

QUEUE_MAX_RETRIES=5
SETTLEMENT_RETRY_COUNT=3
SETTLEMENT_RETRY_DELAYS_MS=60000,300000,1800000
EMAIL_RETRY_COUNT=1
EMAIL_RETRY_DELAYS_MS=300000
STELLAR_MONITOR_RETRY_COUNT=1
STELLAR_MONITOR_RETRY_DELAYS_MS=0
```

#### Email

```bash
EMAIL_PROVIDER=smtp                     # smtp or sendgrid
EMAIL_SMTP_HOST=smtp.sendgrid.net
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=apikey
EMAIL_SMTP_PASS=your_sendgrid_api_key_or_smtp_password
EMAIL_FROM=noreply@dupdub.xyz
EMAIL_FROM_NAME=DupDub
SENDGRID_API_KEY=
```

> Two email paths read different SMTP variables. `src/email/nodemailer.service.ts` uses the `EMAIL_SMTP_*` set above. The notifications queue (`src/notifications/email.processor.ts`, used by `NotificationsService.enqueueEmail` for AML alerts etc.) reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` and `SMTP_PASS`; set these too or queued emails will not be delivered. Both read `EMAIL_FROM`.

#### Monitoring, alerting & observability

```bash
SENTRY_DSN=https://xxx@sentry.io/xxx

UPTIMEROBOT_API_KEY=
BETTER_UPTIME_API_TOKEN=
BETTER_UPTIME_HEARTBEAT_URL=https://betteruptime.com/api/v1/heartbeat/xxxxx

ADMIN_ALERT_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
ADMIN_ALERT_EMAIL=oncall@dupdub.xyz
ADMIN_ALERT_COOLDOWN_MINUTES=30
ADMIN_ALERT_FAILURE_THRESHOLD=1
ADMIN_ALERT_STELLAR_FAILURE_THRESHOLD=1
GRAFANA_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz

OTEL_ENABLED=false
OTEL_SERVICE_NAME=dupdub-backend
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_TRACE_CONSOLE=false
```

#### Admin & backups

```bash
ADMIN_ALLOWED_IPS=127.0.0.1,::1
ADMIN_IP_BYPASS_IN_DEV=true

BACKUP_S3_BUCKET=dupdub-db-backups
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ENDPOINT=
BACKUP_S3_ACCESS_KEY_ID=your_access_key_id
BACKUP_S3_SECRET_ACCESS_KEY=your_secret_access_key
BACKUP_RETENTION_DAYS=30
```

## API documentation

- **Interactive docs**: `GET /docs` (Swagger UI), raw OpenAPI JSON at `GET /docs-json`
- **Base path**: all routes below are under `/api/v1` unless noted
- **Auth**: `Authorization: Bearer <JWT>` (from `/auth/login`) or `X-API-Key: <merchant API key>` — both schemes are wired up in Swagger's "Authorize" button

| Area                   | Endpoints                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                   | `POST /auth/register`, `POST /auth/login`                                                                                                                                 |
| Payments               | `POST /payments`, `POST /payments/batch`, `GET /payments`, `GET /payments/stats`, `GET /payments/:id`, `POST /payments/:id/refund`, `GET /pay/:reference`                 |
| Payments (QR/receipts) | `POST /payments`, `GET /payments/:id/status`, `GET /payments/:id/qr-code`, `POST /payments/:id/cancel`, `GET /payments/reference/:reference`, `GET /payments/:id/receipt` |
| Settlements            | `GET /settlements`, `POST /settlements/partner-callback` (partner-facing)                                                                                                 |
| Merchants              | `GET /merchants/me`, `PATCH /merchants/me`, `POST /merchants/api-keys`, `GET`/`PATCH /merchants/me/notification-prefs`                                                    |
| Webhooks               | `GET /webhooks`, `POST /webhooks`, `DELETE /webhooks/:id`, `GET`/`PATCH /webhooks/retry-config`                                                                           |
| Wallet                 | `GET /wallet`, `GET /wallet/balance`                                                                                                                                      |
| Waitlist               | `POST /waitlist/join`, `GET /waitlist/check/:username`, `GET /waitlist/stats`                                                                                             |
| Health                 | `GET /health`, `GET /health/ready` (excluded from the `/api/v1` prefix)                                                                                                   |

Treat Swagger (`/docs`) as the source of truth for request/response shapes — the table above is a map of what exists, not the full contract.

### Outbound webhooks

Merchants register a URL via `POST /webhooks`; deliveries are HMAC-signed with `WEBHOOK_SECRET` and retried on the schedule in `WEBHOOK_RETRY_DELAYS_MS`. Merchants can set `maxAttempts` and `retryDelays` (milliseconds) with `PATCH /webhooks/retry-config`; unset policies use the global schedule. Attempts are limited to 10 and each delay to 24 hours. Events currently dispatched:

- `payment.confirmed` — deposit detected and confirmed on Stellar
- `payment.expired` — payment request expired before a deposit arrived
- `payment.settling` — settlement to fiat has started
- `payment.settled` — merchant has received fiat
- `payment.failed` — settlement failed
- `payment.refunded` — a payment was refunded

### Cache versioning

All `CacheService` keys include `NODE_ENV` and `CACHE_VERSION` (`v1` when unset). Set `CACHE_VERSION` to the deployed commit SHA or another immutable release identifier. Changing it immediately makes previous-version keys unreachable; old entries expire under their existing TTLs. Keep the same version across instances in one deployment.

#### Verifying webhook signatures

Every delivery is a `POST` with a JSON body and two headers:

| Header | Value |
|---|---|
| `X-Webhook-Signature` | Lowercase hex HMAC-SHA256 of the raw request body, keyed with the webhook's secret |
| `X-Webhook-Event` | Event name, e.g. `payment.confirmed` |
| `X-Webhook-Replay` | `true` only on deliveries re-sent via `POST /webhooks/replay` |

The body is `{ "event": "...", "data": { ... }, "timestamp": "2026-10-20T12:00:00.000Z" }`. The signature covers the exact bytes received, so verify against the raw body **before** parsing or re-serialising JSON. The secret is the one you supplied when creating the webhook (`secret` on `POST /webhooks`) or the generated value returned for it.

Verification steps:

1. Read the raw body as bytes or a string.
2. Compute `HMAC-SHA256(secret, rawBody)` and hex-encode it.
3. Compare it to `X-Webhook-Signature` with a constant-time comparison.
4. Parse the body and check `timestamp` for replay protection (see below).

**Node.js** (Express — use `express.raw` so the body is not parsed first):

```js
const crypto = require('crypto');
const express = require('express');

const app = express();
const SECRET = process.env.DUPDUB_WEBHOOK_SECRET;
const MAX_AGE_MS = 5 * 60 * 1000;

app.post('/webhooks/dupdub', express.raw({ type: 'application/json' }), (req, res) => {
  const received = req.get('X-Webhook-Signature') || '';
  const expected = crypto.createHmac('sha256', SECRET).update(req.body).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).send('invalid signature');
  }

  const payload = JSON.parse(req.body.toString('utf8'));
  if (Math.abs(Date.now() - Date.parse(payload.timestamp)) > MAX_AGE_MS) {
    return res.status(401).send('stale webhook');
  }

  // handle payload.event / payload.data here
  res.sendStatus(200);
});
```

**Python** (Flask):

```python
import hmac
import hashlib
import json
import os
from datetime import datetime, timezone

from flask import Flask, request, abort

app = Flask(__name__)
SECRET = os.environ["DUPDUB_WEBHOOK_SECRET"].encode()
MAX_AGE_SECONDS = 5 * 60


@app.post("/webhooks/dupdub")
def dupdub_webhook():
    raw = request.get_data()  # raw bytes, before any JSON parsing
    expected = hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
    received = request.headers.get("X-Webhook-Signature", "")
    if not hmac.compare_digest(expected, received):
        abort(401)

    payload = json.loads(raw)
    sent_at = datetime.fromisoformat(payload["timestamp"].replace("Z", "+00:00"))
    age = (datetime.now(timezone.utc) - sent_at).total_seconds()
    if abs(age) > MAX_AGE_SECONDS:
        abort(401)

    # handle payload["event"] / payload["data"] here
    return "", 200
```

**PHP**:

```php
<?php

$secret = getenv('DUPDUB_WEBHOOK_SECRET');
$maxAgeSeconds = 5 * 60;

$raw = file_get_contents('php://input'); // raw body, before any parsing
$expected = hash_hmac('sha256', $raw, $secret);
$received = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? '';

if (!hash_equals($expected, $received)) {
    http_response_code(401);
    exit('invalid signature');
}

$payload = json_decode($raw, true);
$sentAt = strtotime($payload['timestamp']);
if ($sentAt === false || abs(time() - $sentAt) > $maxAgeSeconds) {
    http_response_code(401);
    exit('stale webhook');
}

// handle $payload['event'] / $payload['data'] here
http_response_code(200);
```

#### Replay protection

The `timestamp` field is inside the signed body, so an attacker cannot change it without breaking the signature. Reject deliveries whose `timestamp` is outside a tolerance window (5 minutes in the examples above).

Be aware of two cases where the original `timestamp` is older than the time you receive the request:

- **Retries.** Failed deliveries are retried on the schedule in `WEBHOOK_RETRY_DELAYS_MS` (up to hours later). Retries re-send the original body, so they keep the original `timestamp`.
- **Replays.** Deliveries from `POST /webhooks/replay` also keep the original `timestamp` and set `X-Webhook-Replay: true`.

If you apply a strict freshness check, either accept these cases with a wider window for them, or deduplicate on a hash of the raw body (`SHA-256(rawBody)`) for a period at least as long as your retry window. Payloads have no separate event ID, so the raw body hash is the stable identifier for a given event.

#### Testing your setup

`POST /api/v1/webhooks/test` (requires the `webhooks:manage` scope) sends a signed `webhook.test` event to every active webhook on your account, regardless of which events each one subscribes to. Use it to confirm your endpoint is reachable and that your signature check passes:

```bash
curl -X POST https://<your-api-host>/api/v1/webhooks/test \
  -H "X-API-Key: $DUPDUB_API_KEY"
```

The response returns `{ "enqueued": <number of webhooks> }`. Deliveries are asynchronous; each attempt is recorded in the webhook delivery log with its response code or error.

## Testing

```bash
pnpm test          # unit tests
pnpm test:cov      # unit tests with coverage
pnpm test:e2e      # e2e specs (spins up against a real Postgres — see test/*.e2e-spec.ts)
pnpm test:integration
```

CI also runs migration safety/rollback checks, an uncommitted-migration check, and a raw-SQL-injection scan (`ci-sql-injection-check` equivalent) — see the workflows in this repo's CI config.

## Monitoring & ops

- Prometheus metrics + Grafana dashboards, Loki/Promtail log shipping — see the `dupdapp_stellar` repo's `grafana/` and `docker-compose.yml` for the local observability stack (backend log volume must be pointed at this repo's `logs/` directory if you wire that up locally).
- Uptime/status page config: see `monitoring/` in `dupdapp_stellar`.
- `AdminAlertService` pushes Slack/email alerts on repeated Stellar-monitor or settlement failures (`ADMIN_ALERT_*` env vars).

### DB connection pool sizing

`DB_POOL_MIN` / `DB_POOL_MAX` set the per-instance pg pool. Size `DB_POOL_MAX` from the database, not from traffic:

```
DB_POOL_MAX = min( 2 × vCPU + 1 , (max_connections − reserved) ÷ instances )
```

- `max_connections` is the PostgreSQL server setting (default 100).
- `reserved` is headroom for superuser/admin sessions, migrations and backups (keep at least 10).
- `instances` is the number of backend replicas connecting to the same database.
- Each request holds a connection only while a query runs, so a larger pool than the formula allows just moves the queue into Postgres and makes overload worse.
- With PgBouncer in transaction mode, size the app pool from the PgBouncer side instead (see `src/database/PGBOUNCER.md`).

Pool metrics are exported on `/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `db_pool_size` | Gauge | Open connections (idle + active) |
| `db_pool_active_connections` | Gauge | Connections checked out |
| `db_pool_waiting_queries` | Gauge | Queries waiting for a connection |

`PoolMonitorService` samples every 30s. It logs a warning and raises a `db_pool_exhausted` admin alert when queries are waiting, and raises the same alert type (dedupe key `db-pool-high-utilization`) when active connections stay above 80% of `DB_POOL_MAX` for more than 60s.

## Handsoff notes

<!-- handsoff-issue-340 -->

- #340: RuntimeConfigService.get() passes a raw number instead of {ttlSeconds} to CacheService.set, silently caching config for 24h instead of 60s

<!-- handsoff-issue-137 -->

- #137: SorobanService contract calls are all TODO stubs, not real contract invocations

### Merchant lifecycle verification and coverage

![Coverage gate](https://img.shields.io/badge/coverage%20gate-70%25-blue)

Run `pnpm test:cov:ci` for repository-wide coverage. `jest.config.js` enforces
70% statements, branches, functions and lines; the CI configuration extends it.
Coverage includes untested source files and excludes module wiring, bootstrap,
test files and test doubles. Reports are uploaded as the `coverage` CI artifact.
The badge describes the enforced target, not a claim that the current suite passes.

Run the database-backed merchant suite locally:

```sh
docker compose -f docker-compose.test.yml up -d --wait
pnpm test:e2e
# Cleanup after testing:
docker compose -f docker-compose.test.yml down -v
```

The independent CI job uses PostgreSQL 16 and Redis 6. Each suite rebuilds the
explicit disposable `dupdub_test` database and seeds a second merchant, clears
Redis database 15, then exercises registration, login, payment creation,
confirmation, a Redis settlement job, partner transfer and HTTP webhook receipt.
Auth, payment, settlement and webhook services and database repositories are real.
Stellar quoting and the partner/delivery network boundaries are controlled test
adapters. Confirmation is an internal contract action, so the suite calls the
real confirmation service rather than adding a test-only public API.

### Payment latency benchmark

```sh
TOKEN='<test merchant JWT>' \
CONFIRMATION_DRIVER_URL='http://localhost:4000/fund-testnet-payment' \
BASE_URL='http://localhost:3000/api/v1' \
k6 run --summary-export=payment-latency-summary.json load-tests/payment-latency.k6.ts
```

The funding driver accepts the created payment JSON and submits a testnet payment
to its address/memo. Use an INSTANT-settlement test merchant with working Stellar
and partner adapters. Configure `VUS`, `ITERATIONS` and `TIMEOUT_MS` as needed.
No funding endpoint is exposed by the production merchant API.

The JSON report contains median (p50), p95 and p99 for `payment_creation_ms`,
`payment_confirmation_ms` and `settlement_dispatch_ms`. Creation must have p95
below 200 ms and confirmation below 5,000 ms. HTTP failures and lifecycle
timeouts fail the run. Confirmation includes funding-driver latency and polling
resolution (50 ms); dispatch measures observable settlement initiation after
confirmation, not bank completion or worker execution. The settlement ID is
persisted before enqueue, so this last metric is a proxy for dispatch latency.

Validation on this branch: the PostgreSQL/Redis merchant lifecycle test passed;
54 focused critical-service/context tests passed. The initial full-suite run
reported 41.41% lines, 41.34% statements, 36.36% branches and 30.89% functions;
the 70% gate correctly fails. Existing stale tests and health-controller syntax
errors still prevent a green repository-wide build. No funded testnet k6 run
has been performed, so production latency percentiles are not yet available.

### Local quality checks

Use Node.js 20 and pnpm 9, then run `pnpm install --frozen-lockfile`.
The `prepare` script installs Husky hooks automatically inside a Git checkout.
If hooks are missing after an install, run `pnpm prepare`.

On commit, lint-staged runs `eslint --fix --max-warnings 0` and
`prettier --write` on staged TypeScript files, and Prettier on staged JavaScript,
JSON, Markdown and YAML. Review automatically fixed changes before committing.
On push, `pnpm typecheck` runs `tsc --noEmit`; fix reported type errors before
pushing. Run `pnpm lint` for the full zero-warning check and `pnpm lint:fix`
for automatic fixes. CI runs the same zero-warning lint command.

See [Soroban integration](docs/soroban-integration.md) for contract configuration,
ABI types and payment sequencing, and [API errors](docs/api-errors.md) for stable
error codes and recovery actions.
