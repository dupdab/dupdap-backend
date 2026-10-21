# Grafana dashboards and alert rules

Operational dashboards and alert rules for the DupDap backend. The backend exposes Prometheus metrics at `/metrics` (see `src/prometheus/`).

## Contents

| Path | Description |
|------|-------------|
| `dashboards/platform-overview.json` | Platform dashboard: payment volume, settlement queue depth, Stellar monitor lag, settlement timing, HTTP latency, open admin alerts |
| `dashboards/merchant-overview.json` | Merchant dashboard: payments by status, payment confirmation latency, webhook delivery rate, settlement time |
| `alerts/dupdap-alerts.yaml` | Prometheus alert rules: payment confirmation p95 > 30s, queue depth > 1000 |

## Importing the dashboards

1. In Grafana, go to **Dashboards → New → Import**.
2. Upload the JSON file (or paste its contents).
3. Select the Prometheus data source that scrapes the backend's `/metrics` endpoint. The dashboards use a `datasource` variable, so this is chosen at import time.

The dashboards have stable UIDs (`dupdap-platform`, `dupdap-merchant`), so re-importing overwrites the existing copy instead of creating a duplicate.

## Loading the alert rules

Add the file to the Prometheus configuration:

```yaml
rule_files:
  - /etc/prometheus/rules/dupdap-alerts.yaml
```

Or import it into Grafana managed alerting as a Prometheus rule group.

## Metrics not yet exported

Some panels and alerts depend on metrics that the backend does not export yet. Until they are added, those panels show "No data" and the related alerts never fire.

| Metric | Type | Labels | Used by | Where it should be recorded |
|--------|------|--------|---------|-----------------------------|
| `queue_depth` | Gauge | `queue` | Queue depth panel, `QueueDepthHigh` alert | Bull queue waiting count, sampled alongside `QueueMetricsService.collect()` |
| `stellar_monitor_lag_seconds` | Gauge | — | Stellar monitor lag panel | `StellarMonitorService` (age of the last processed ledger) |
| `payment_confirmation_duration_seconds` | Histogram | — | Confirmation p50/p95 panel, `PaymentConfirmationP95High` alert | Payment confirmation path in `PaymentsService` |
| `payment_status_total` | Counter | `status` | Payments by status panel | Wherever payment status transitions are persisted |
| `webhook_deliveries_total` | Counter | `status` (`delivered`, `failed`, ...) | Webhook rate panels | `WebhookDeliveryProcessor` |

Exported today and used by the dashboards: `payment_created_total`, `payment_settled_total`, `settlement_failed_total`, `settlement_duration_seconds`, `http_request_duration_ms`, `admin_alerts_open`.

## Notes

- Use `route` (the Nest route template) rather than the raw URL for HTTP panels to keep cardinality bounded. See `src/prometheus/GRAFANA.md` for per-endpoint latency panels.
- Keep `scrape_interval` at 15s or lower so `rate()` windows stay accurate.
