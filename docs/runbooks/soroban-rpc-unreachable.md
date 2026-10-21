# Soroban RPC unreachable

## Symptoms

- Soroban contract reads or writes fail with connection, timeout, or gateway errors.
- Payment confirmations or contract-backed settlement operations stop progressing.
- Logs show repeated failures against the configured RPC endpoint.

## Likely root causes

- RPC provider outage, DNS/network failure, request throttling, or incorrect endpoint.
- Wrong network passphrase, contract ID, or source account configuration.

## Remediation

1. Check provider status and test `SOROBAN_RPC_URL` reachability from the backend environment.
2. Verify endpoint, network passphrase, contract IDs, and account configuration for the current environment.
3. Check RPC rate limits and service logs for request IDs and retry patterns.
4. Restore provider connectivity or switch to the approved endpoint, then verify contract reads and a safe operation before replaying queued writes.
5. Reconcile any transaction with an unknown submission result before retrying it.

## Escalation

Escalate to the blockchain on-call engineer and RPC provider when connectivity remains unavailable. Include network, endpoint host, time range, sanitized request IDs, and transaction hashes.
