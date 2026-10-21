# Stellar monitor stuck

## Symptoms

- Stellar payment confirmations stop arriving while the API remains available.
- The Stellar monitor or Soroban indexer cursor has not advanced for several polling intervals.
- Queue or application logs show repeated monitor errors.

## Likely root causes

- Horizon or Soroban RPC is unavailable, slow, or configured for the wrong network.
- The monitor worker is not running or is repeatedly restarting.
- Redis is unavailable and persisted cursor state cannot be read or written.
- The configured contract or Stellar account is incorrect.

## Remediation

1. Check `/health/ready`, application logs, and the `stellar-monitor` and Soroban queue states.
2. Verify `STELLAR_HORIZON_URL`, `SOROBAN_RPC_URL`, network, contract IDs, and credentials against the active deployment.
3. Check the provider status and test RPC reachability from the application environment.
4. Restore Redis if unavailable, then restart the monitor worker. Confirm its cursor advances and new events are processed without duplicates.
5. Do not reset or delete cursor keys unless the Stellar on-call owner has confirmed a safe replay point.

## Escalation

Escalate to the blockchain on-call engineer if the cursor remains unchanged after provider connectivity and worker health are restored. Include deployment, network, last cursor, and relevant log excerpts.
