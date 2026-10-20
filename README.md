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

| Module | Responsibility |
|---|---|
| `payments/`, `payment/` | Payment request lifecycle, QR codes, receipts, batch payments |
| `stellar/` | Horizon polling (`StellarMonitorService`), Soroban event indexing, `StellarService` (SDK wrapper, `invokeContract`) |
| `soroban/` | Lower-level Soroban RPC client used by wallet provisioning and contract calls |
| `blockchain-wallet/` | Server-side Stellar keypair provisioning per user (AES-256-GCM encrypted secret storage), balance sync, slippage handling |
| `settlements/` | Crypto→fiat settlement orchestration, partner callback handling |
| `merchants/` | Merchant profile, API key issuance/scoping, notification preferences |
| `webhooks/` | Webhook registration, signed delivery, retry/backoff, failure alerting |
| `waitlist/` | Public waitlist signup/lookup/stats |
| `auth/` | Registration/login, JWT + API key guards |
| `admin/` | Internal admin operations and reporting |
| `analytics/` | Merchant-facing and platform-wide analytics |
| `aml/` | Anti-money-laundering checks |
| `groups/` | Merchant grouping/org structures |
| `notifications/`, `email/` | Notification preferences and email delivery (SMTP/SendGrid) |
| `queues/`, `retry/` | Bull/Redis queue definitions and per-queue retry policies |
| `cache/` | Redis-backed caching (requires a reachable Redis instance) |
| `cron/` | Scheduled jobs |
| `backup/` | Database backup to S3 |
| `audit/` | Audit logging for compliance |
| `security/` | Security-related guards/utilities |
| `prometheus/`, `sentry/`, `telemetry/` | Metrics export, error tracking, OpenTelemetry tracing |
| `health/` | Liveness/readiness endpoints |
| `common/`, `core/`, `config/`, `database/`, `runtime-config/` | Shared interceptors/filters, TypeORM setup + migrations, config loading |

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

| Script | Purpose |
|---|---|
| `pnpm migration:generate` / `migration:run` / `migration:revert` / `migration:show` | TypeORM migrations |
| `pnpm db:seed` / `db:seed:test` / `db:reset` | Local DB seeding/reset |
| `pnpm migration:check` / `migration:rollback:check` / `migration:uncommitted:check` | CI safety checks on migrations |
| `pnpm test:cov` | Unit tests with coverage |
| `pnpm test:integration` | Integration specs (`*.integration-spec.ts`) |
| `pnpm test:e2e` | End-to-end specs (`*.e2e-spec.ts`) |
| `pnpm explain:queries` | Run `EXPLAIN` on the list/query endpoints |

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
STELLAR_NETWORK=TESTNE

/* … truncated 6553 chars — edit only what you need near the top … */
