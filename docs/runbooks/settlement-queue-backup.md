# Settlement queue backup

## Symptoms

- Pending settlements age beyond their normal processing window.
- The settlement queue has a growing waiting or delayed count, or workers show sustained failures.
- Merchants report missing fiat payouts.

## Likely root causes

- Settlement workers are stopped, under-provisioned, or blocked by repeated retries.
- The partner API is unavailable or rejecting requests.
- Redis connectivity or queue state is unhealthy.
- Invalid settlement configuration or credentials cause jobs to fail consistently.

## Remediation

1. Inspect the settlement queue metrics and failed jobs through the admin queue endpoints; identify the oldest job and common failure reason.
2. Check worker health, Redis readiness, and partner API status before retrying jobs.
3. Correct credentials or settlement configuration, then restore or scale workers as needed.
4. Retry failed jobs in controlled batches and confirm queue depth falls and settlements reach a terminal state.
5. Reconcile retried payouts with the partner before replaying ambiguous requests to avoid duplicate transfers.

## Escalation

Escalate to Payments Operations for aged payouts or possible duplicate transfers. Include oldest job age, queue counts, settlement IDs, partner responses, and retry actions.
