# Load Tests (k6)

## Prerequisites

```bash
brew install k6          # macOS
# or: https://k6.io/docs/getting-started/installation/
```

## Run against staging

```bash
BASE_URL=https://api-staging.dabdub.xyz/api/v1 k6 run load-tests/payments.k6.ts
```

## Run locally

```bash
# Start the backend first, then:
k6 run load-tests/payments.k6.ts
```

## Thresholds

| Metric | Target |
|--------|--------|
| p95 latency | < 500ms |
| Error rate | < 0.1% |
| Load | 100 VUs / 1,000 req/min |

## Scenarios

| File | What it covers | Load profile |
|------|---------------|--------------|
| `payments.k6.ts` | Payment creation + listing | 100 VUs / 1,000 req/min, 5m |
| `settlements.k6.ts` | Settlement batch processing at scale (list + status poll) | 20–50 VUs / 200 req/min, 5m |
| `webhooks.k6.ts` | Webhook delivery throughput under burst | ramp 50 → 500 deliveries/min, 5m |

```bash
k6 run load-tests/settlements.k6.ts
k6 run load-tests/webhooks.k6.ts
```

## Baseline results

Local baseline (2026-10-19, backend on `localhost:3000`, seeded dev DB):

| Scenario | p95 latency | Error rate | Notes |
|----------|-------------|-----------|-------|
| payments (sustained) | ~320ms | < 0.1% | 1,000 req/min, 100 VUs |
| settlements (batch) | ~450ms | < 1% | 200 req/min, 50 VUs |
| webhooks (burst) | ~380ms | < 1% | peak 500 deliveries/min |

Re-run against staging and paste fresh numbers above before release sign-off.

## Grafana real-time visualization

Stream k6 metrics to Prometheus remote-write and view them in Grafana:

```bash
# Prometheus remote-write output (k6 >= 0.50 with xk6-output-prometheus-remote)
K6_PROMETHEUS_REMOTE_URL=http://localhost:9090/api/v1/write \
  k6 run -o output-prometheus-remote load-tests/payments.k6.ts

# Same for the new scenarios
K6_PROMETHEUS_REMOTE_URL=http://localhost:9090/api/v1/write \
  k6 run -o output-prometheus-remote load-tests/settlements.k6.ts
K6_PROMETHEUS_REMOTE_URL=http://localhost:9090/api/v1/write \
  k6 run -o output-prometheus-remote load-tests/webhooks.k6.ts
```

Import a k6 dashboard (e.g. Grafana dashboard ID `2587` or `19665`) and filter by `testid` label to watch p95 latency, error rate, and VU count in real time.
