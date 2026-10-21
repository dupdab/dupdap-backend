# Settlement partner API unavailable

## Symptoms

- Settlement submissions time out or return repeated 5xx/connection errors.
- Settlement queue backlog and retries increase while payment confirmation continues.
- Partner callbacks stop arriving.

## Likely root causes

- Partner outage, network or DNS issue, or an expired/rotated API credential.
- Incorrect `PARTNER_API_URL` or partner-side rate limiting.
- Partner callback signing secret mismatch.

## Remediation

1. Check partner status and test `PARTNER_API_URL` reachability from the service environment.
2. Verify `PARTNER_API_KEY` and `PARTNER_WEBHOOK_SECRET` against the approved secret store; do not place credentials in incident notes.
3. Coordinate with the partner before replaying timed-out submissions whose outcome is unknown.
4. Allow configured retries to proceed after recovery, then monitor queue depth and reconcile settlement statuses with partner records.

## Escalation

Escalate to Payments Operations and the partner contact if the outage exceeds the settlement SLA or any transfer outcome is ambiguous. Include affected settlement IDs, request times, response codes, and reconciliation status.
