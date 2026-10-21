# Redis unavailable

## Symptoms

- `/health/ready` reports Redis as unhealthy, or logs show connection and timeout errors.
- Bull queues stop making progress; cache misses or rate-limit fallback warnings increase.
- Multiple workers fail to coordinate or repeatedly reconnect.

## Likely root causes

- Redis process or managed service outage, network partition, or exhausted connections.
- Incorrect `REDIS_URL`, host, port, password, or TLS settings.
- Redis memory pressure or connection limits.

## Remediation

1. Check Redis provider health, connectivity from the application network, memory, and client connection counts.
2. Verify Redis environment settings and secrets, then restore service or network access.
3. Confirm application clients reconnect and `/health/ready` returns healthy.
4. Inspect queue waiting, active, and failed counts; resume workers and retry only jobs safe to replay.
5. Confirm cache and rate-limit behavior has returned to normal. Do not flush Redis during recovery because it also stores queue state.

## Escalation

Escalate to Infrastructure on-call if Redis cannot be restored or queue state may be lost. Provide provider incident details, connection errors, and queue counts.
