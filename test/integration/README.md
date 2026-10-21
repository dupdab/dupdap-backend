Run `pnpm test:integration` with `TEST_DATABASE_URL` pointing to a disposable PostgreSQL 16 database.
The default is `postgres://postgres:integration@localhost:55432/dupdap_integration`.
Each suite creates and drops a unique schema; it never drops the database.

For local use:

```sh
docker run --rm --name dupdap-tests -e POSTGRES_PASSWORD=integration -e POSTGRES_DB=dupdap_integration -p 55432:5432 postgres:16-alpine
pnpm test:integration
```

The lifecycle suite uses real payment, settlement, monitor, webhook services and TypeORM repositories.
Horizon/Soroban interfaces, partner HTTP, email, and delivery queue boundaries are mocked.
Cases cover successful settlement, duplicate scans, rate/Horizon/RPC/partner/queue failures,
unverified transfers and expiration. CI runs this suite in its own PostgreSQL-backed job.
