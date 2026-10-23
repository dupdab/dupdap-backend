import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { CircuitBreaker, CircuitState } from '../common/circuit-breaker';

export const RPC_MAX_ATTEMPTS = 3;
export const RPC_BASE_DELAY_MS = 250;
export const RPC_CIRCUIT_FAILURE_THRESHOLD = 5;
export const RPC_CIRCUIT_RESET_MS = 30_000;

/** True for outages and timeouts that are worth retrying (not for rejected requests). */
export function isTransientRpcError(error: unknown): boolean {
  const candidate = error as
    | { response?: { status?: number }; status?: number; code?: string; message?: string }
    | undefined;
  const status = Number(candidate?.response?.status ?? candidate?.status);
  if ([408, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const text = `${candidate?.code ?? ''} ${candidate?.message ?? ''}`.toLowerCase();
  return [
    'timeout',
    'temporarily unavailable',
    'network',
    'socket hang up',
    'econnreset',
    'econnrefused',
    'eai_again',
    'etimedout',
    '503',
    '502',
  ].some((fragment) => text.includes(fragment));
}

export interface SorobanRpcResilienceOptions {
  name: string;
  isRetryable?: (error: unknown) => boolean;
  /** Called once each time the circuit opens. */
  onCircuitOpen?: (consecutiveFailures: number) => void;
  onCircuitStateChange?: (state: CircuitState) => void;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Retries transient RPC errors with exponential backoff, falls back to a
 * secondary endpoint when the primary keeps failing, and opens a circuit
 * after repeated failures so an outage fails fast instead of piling up calls.
 */
export class SorobanRpcResilience<C> {
  private readonly logger = new Logger('SorobanRpcResilience');
  private readonly breaker: CircuitBreaker;
  private readonly isRetryable: (error: unknown) => boolean;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly primary: C,
    private readonly fallback: C | undefined,
    private readonly options: SorobanRpcResilienceOptions,
  ) {
    this.isRetryable = options.isRetryable ?? isTransientRpcError;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.breaker = new CircuitBreaker({
      name: options.name,
      failureThreshold: RPC_CIRCUIT_FAILURE_THRESHOLD,
      resetTimeoutMs: RPC_CIRCUIT_RESET_MS,
      onStateChange: (state) => {
        this.options.onCircuitStateChange?.(state);
        if (state === 'open') {
          this.logger.error(`${this.options.name} circuit opened after ${this.breaker.failures} consecutive failures`);
          this.options.onCircuitOpen?.(this.breaker.failures);
        }
      },
    });
  }

  isCircuitOpen(): boolean {
    return this.breaker.isOpen();
  }

  async call<T>(action: string, operation: (client: C) => Promise<T>): Promise<T> {
    if (this.breaker.isOpen()) {
      throw new ServiceUnavailableException(
        `Soroban RPC circuit is open; ${action} was not attempted`,
      );
    }

    try {
      const result = await this.withBackoff(this.primary, action, 'primary', operation);
      this.breaker.recordSuccess();
      return result;
    } catch (primaryError) {
      if (!this.isRetryable(primaryError)) {
        throw primaryError;
      }

      if (this.fallback !== undefined) {
        this.logger.warn(`Soroban RPC ${action} failed on the primary endpoint; trying the fallback`);
        try {
          const result = await this.withBackoff(this.fallback, action, 'fallback', operation);
          this.breaker.recordSuccess();
          return result;
        } catch (fallbackError) {
          if (!this.isRetryable(fallbackError)) {
            throw fallbackError;
          }
          this.breaker.recordFailure();
          throw fallbackError;
        }
      }

      this.breaker.recordFailure();
      throw primaryError;
    }
  }

  private async withBackoff<T>(
    client: C,
    action: string,
    endpoint: 'primary' | 'fallback',
    operation: (client: C) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation(client);
      } catch (error) {
        if (attempt >= RPC_MAX_ATTEMPTS || !this.isRetryable(error)) {
          throw error;
        }

        const delayMs = RPC_BASE_DELAY_MS * 2 ** (attempt - 1);
        this.logger.warn(
          `Soroban RPC ${action} failed on ${endpoint} attempt ${attempt}; retrying in ${delayMs}ms`,
        );
        await this.sleep(delayMs);
      }
    }
  }
}
