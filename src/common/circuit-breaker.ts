export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(public readonly circuit: string) {
    super(`Circuit "${circuit}" is open`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  name: string;
  /** Consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open before a trial request is allowed. */
  resetTimeoutMs: number;
  /** Decides whether an error counts as a failure. Defaults to every error. */
  isFailure?: (error: unknown) => boolean;
  onStateChange?: (state: CircuitState, previous: CircuitState) => void;
  now?: () => number;
}

/**
 * Minimal circuit breaker: `closed` -> `open` after N consecutive failures,
 * `open` -> `half-open` after the reset timeout, and `half-open` closes on a
 * success or re-opens on the next failure.
 */
export class CircuitBreaker {
  private current: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  get state(): CircuitState {
    if (
      this.current === 'open' &&
      this.now() - this.openedAt >= this.options.resetTimeoutMs
    ) {
      this.transition('half-open');
    }
    return this.current;
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  get failures(): number {
    return this.consecutiveFailures;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new CircuitOpenError(this.options.name);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      if (this.options.isFailure?.(error) ?? true) {
        this.recordFailure();
      }
      throw error;
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.current !== 'closed') {
      this.transition('closed');
    }
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (
      this.current === 'half-open' ||
      this.consecutiveFailures >= this.options.failureThreshold
    ) {
      this.openedAt = this.now();
      if (this.current !== 'open') {
        this.transition('open');
      }
    }
  }

  private transition(next: CircuitState): void {
    const previous = this.current;
    this.current = next;
    this.options.onStateChange?.(next, previous);
  }
}
