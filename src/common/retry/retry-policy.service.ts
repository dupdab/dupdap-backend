import { Injectable } from '@nestjs/common';

export interface RetryPolicyOptions {
  /** Base delay in milliseconds for the first retry. */
  baseDelayMs: number;
  /** Multiplier applied to the delay on each subsequent attempt. */
  multiplier: number;
  /** Maximum number of attempts (including the initial one). */
  maxAttempts: number;
  /** Maximum jitter in milliseconds added to each delay. */
  jitterMs?: number;
  /** Upper bound for a single delay in milliseconds. */
  maxDelayMs?: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicyOptions = {
  baseDelayMs: 1000,
  multiplier: 2,
  maxAttempts: 5,
  jitterMs: 0,
  maxDelayMs: 60_000,
};

/**
 * Reusable exponential backoff scheduling used by webhook and settlement
 * retry jobs. Keeps the backoff math in one place so both consumers stay
 * consistent and configurable.
 */
@Injectable()
export class RetryPolicyService {
  /**
   * Compute the delay (in ms) before the given attempt.
   * `attempt` is 1-based: attempt 1 is the first retry after the initial try.
   */
  computeDelay(attempt: number, options: Partial<RetryPolicyOptions> = {}): number {
    const policy = { ...DEFAULT_RETRY_POLICY, ...options };
    const safeAttempt = Math.max(1, Math.floor(attempt));
    const exponential = policy.baseDelayMs * Math.pow(policy.multiplier, safeAttempt - 1);
    const capped = policy.maxDelayMs ? Math.min(exponential, policy.maxDelayMs) : exponential;
    const jitter = policy.jitterMs ? Math.floor(Math.random() * (policy.jitterMs + 1)) : 0;
    return Math.floor(capped) + jitter;
  }

  /** Whether another attempt is allowed given the number of attempts already made. */
  shouldRetry(attemptsMade: number, options: Partial<RetryPolicyOptions> = {}): boolean {
    const policy = { ...DEFAULT_RETRY_POLICY, ...options };
    return attemptsMade < policy.maxAttempts;
  }

  /**
   * Build the full backoff schedule (delays in ms) for every retry up to
   * `maxAttempts`. Useful for queue/job configuration.
   */
  buildSchedule(options: Partial<RetryPolicyOptions> = {}): number[] {
    const policy = { ...DEFAULT_RETRY_POLICY, ...options };
    const schedule: number[] = [];
    for (let attempt = 1; attempt < policy.maxAttempts; attempt++) {
      schedule.push(this.computeDelay(attempt, policy));
    }
    return schedule;
  }
}
