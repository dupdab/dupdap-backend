import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { CacheService } from '../cache/cache.service';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { StellarTxQueueService } from './stellar-tx-queue.service';
import { Gauge } from 'prom-client';
import { CircuitBreaker, CircuitState } from '../common/circuit-breaker';
import {
  RPC_CIRCUIT_FAILURE_THRESHOLD,
  RPC_CIRCUIT_RESET_MS,
  SorobanRpcResilience,
  isTransientRpcError,
} from './soroban-rpc-resilience';

const CIRCUIT_STATE_VALUE: Record<CircuitState, number> = { closed: 0, 'half-open': 1, open: 2 };

/** Horizon polling circuit state: 0 = closed, 1 = half-open, 2 = open. */
export const stellarHorizonCircuitState = new Gauge({
  name: 'stellar_horizon_circuit_state',
  help: 'Horizon circuit breaker state (0=closed, 1=half-open, 2=open)',
});

/** Horizon payment operation fields read by `verifyPayment`. */
export interface HorizonPaymentRecord {
  type: string;
  asset_code?: string;
  asset_issuer?: string;
  asset_type?: string;
  amount: string;
  from?: string;
}

/** Horizon account balance line (native and credit assets). */
export interface HorizonBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

export interface XlmUsdRate {
  rate: number;
  isFallback: boolean;
}

export { SorobanRpcException } from './soroban-rpc.exception';
import { SorobanRpcException } from './soroban-rpc.exception';

@Injectable()
export class StellarService implements OnModuleInit {
  private readonly logger = new Logger(StellarService.name);
  private readonly exchangeRateCacheKey = 'exchange-rate:xlm-usd';
  private readonly exchangeRateTtlSeconds = 30;
  private readonly lastKnownGoodRateKey = 'exchange-rate:xlm-usd:last-known-good';
  private server: StellarSdk.Horizon.Server;
  private sorobanRpcServer: StellarSdk.rpc.Server;
  private keypair: StellarSdk.Keypair;
  private networkPassphrase: string;
  private usdcAsset: StellarSdk.Asset;
  private sorobanContractId: string;
  private horizonBreaker: CircuitBreaker;
  private sorobanRpc: SorobanRpcResilience<StellarSdk.rpc.Server>;

  constructor(
    private config: ConfigService,
    private readonly cacheService: CacheService,
    private readonly adminAlertService: AdminAlertService,
    private readonly stellarTxQueue: StellarTxQueueService,
  ) {}

  onModuleInit() {
    const network = this.config.get('STELLAR_NETWORK', 'TESTNET');
    const horizonUrl = this.config.get(
      'STELLAR_HORIZON_URL',
      network === 'PUBLIC' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org',
    );

    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.sorobanRpcServer = new StellarSdk.rpc.Server(
      this.config.get('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org'),
    );
    this.networkPassphrase =
      network === 'PUBLIC' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;

    this.horizonBreaker = new CircuitBreaker({
      name: 'stellar-horizon',
      failureThreshold: RPC_CIRCUIT_FAILURE_THRESHOLD,
      resetTimeoutMs: RPC_CIRCUIT_RESET_MS,
      isFailure: isTransientRpcError,
      onStateChange: (state) => {
        stellarHorizonCircuitState.set(CIRCUIT_STATE_VALUE[state]);
        if (state === 'open') {
          this.logger.error('Horizon circuit breaker opened; Stellar polling is paused');
          void this.adminAlertService
            .raise({
              type: AdminAlertType.STELLAR_MONITOR,
              dedupeKey: 'horizon-circuit',
              message: `Horizon circuit breaker opened after ${RPC_CIRCUIT_FAILURE_THRESHOLD} consecutive failures; Stellar polling is paused until it recovers.`,
              metadata: { horizonUrl },
              thresholdValue: RPC_CIRCUIT_FAILURE_THRESHOLD,
            })
            .catch((error) =>
              this.logger.error(`Failed to raise Horizon circuit alert: ${error instanceof Error ? error.message : error}`),
            );
        } else {
          this.logger.log(`Horizon circuit breaker is ${state}`);
        }
      },
    });
    stellarHorizonCircuitState.set(CIRCUIT_STATE_VALUE.closed);

    const fallbackRpcUrl = this.config.get<string>('SOROBAN_RPC_FALLBACK_URL');
    this.sorobanRpc = new SorobanRpcResilience<StellarSdk.rpc.Server>(
      this.sorobanRpcServer,
      fallbackRpcUrl ? new StellarSdk.rpc.Server(fallbackRpcUrl) : undefined,
      {
        name: 'stellar-service-soroban-rpc',
        onCircuitOpen: (failures) => {
          void this.adminAlertService
            .raise({
              type: AdminAlertType.STELLAR_MONITOR,
              dedupeKey: 'stellar-service-soroban-circuit',
              message: `Soroban RPC circuit breaker opened after ${failures} consecutive failures.`,
              metadata: { failures, fallbackConfigured: Boolean(fallbackRpcUrl) },
              thresholdValue: failures,
            })
            .catch((error) =>
              this.logger.error(`Failed to raise Soroban circuit alert: ${error instanceof Error ? error.message : error}`),
            );
        },
      },
    );

    const secret = this.config.get('STELLAR_ACCOUNT_SECRET');
    if (secret) {
      this.keypair = StellarSdk.Keypair.fromSecret(secret);
    }

    const usdcIssuer = this.config.get(
      'STELLAR_USDC_ISSUER',
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
    this.usdcAsset = new StellarSdk.Asset('USDC', usdcIssuer);
    this.sorobanContractId = this.config.get('SOROBAN_CONTRACT_ID', '');

    this.logger.log(`Stellar initialized on ${network}`);
  }

  getDepositAddress(): string {
    return this.keypair?.publicKey() ?? this.config.get('STELLAR_ACCOUNT_PUBLIC', '');
  }

  generateMemo(): string {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  async getXlmUsdRate(): Promise<XlmUsdRate> {
    const { value } = await this.cacheService.getOrSet<XlmUsdRate>(
      this.exchangeRateCacheKey,
      async () => {
        try {
          const orderbook = await this.server
            .orderbook(StellarSdk.Asset.native(), this.usdcAsset)
            .call();
          const bestAsk = orderbook.asks[0];
          if (bestAsk) {
            const rate = parseFloat(bestAsk.price);
            await this.cacheService.set(this.lastKnownGoodRateKey, rate, {
              ttlSeconds: 24 * 60 * 60,
            });
            return { rate, isFallback: false };
          }

          return this.resolveFallbackRate('empty orderbook');
        } catch (err) {
          return this.resolveFallbackRate(
            err instanceof Error ? err.message : 'Horizon request failed',
          );
        }
      },
      { ttlSeconds: this.exchangeRateTtlSeconds },
    );

    return value;
  }

  private async resolveFallbackRate(reason: string): Promise<XlmUsdRate> {
    this.logger.warn(`Failed to fetch XLM/USD rate (${reason}), using fallback`);

    const lastKnownGood = await this.cacheService.get<number>(this.lastKnownGoodRateKey);

    if (typeof lastKnownGood === 'number' && lastKnownGood > 0) {
      await this.adminAlertService.raise({
        type: AdminAlertType.STELLAR_MONITOR,
        dedupeKey: 'stellar.rate-fallback',
        message: `Horizon XLM/USD rate unavailable (${reason}); serving last-known-good rate ${lastKnownGood}.`,
        metadata: { reason, lastKnownGood },
        thresholdValue: 1,
      });
      return { rate: lastKnownGood, isFallback: true };
    }

    await this.adminAlertService.raise({
      type: AdminAlertType.STELLAR_MONITOR,
      dedupeKey: 'stellar.rate-unavailable',
      message: `Horizon XLM/USD rate unavailable (${reason}) and no last-known-good rate is cached.`,
      metadata: { reason },
      thresholdValue: 1,
    });

    return { rate: 0.1, isFallback: true };
  }

  /** True while the Horizon circuit is open; callers should pause polling. */
  isHorizonCircuitOpen(): boolean {
    return this.horizonBreaker?.isOpen() ?? false;
  }

  private callHorizon<T>(fn: () => Promise<T>): Promise<T> {
    return this.horizonBreaker ? this.horizonBreaker.execute(fn) : fn();
  }

  async getAccountTransactions(
    accountId: string,
    cursor?: string,
  ): Promise<StellarSdk.Horizon.ServerApi.TransactionRecord[]> {
    const builder = this.server.transactions().forAccount(accountId).order('asc').limit(200);

    if (cursor) builder.cursor(cursor);

    const page = await this.callHorizon(() => builder.call());
    return page.records;
  }

  async getPaymentsForTransaction(txHash: string): Promise<any[]> {
    return this.callHorizon(async () => {
      const tx = await this.server.transactions().transaction(txHash).call();
      const operations = await tx.operations();
      return operations.records;
    });
  }

  async verifyPayment(
    txHash: string,
    expectedMemo: string,
    expectedAmountUsdc?: number,
    assetType: 'XLM' | 'USDC' = 'USDC',
  ): Promise<{ verified: boolean; amount?: number; asset?: string; from?: string }> {
    try {
      const tx = await this.callHorizon(() => this.server.transactions().transaction(txHash).call());

      const memo = tx.memo;
      if (expectedMemo && memo !== expectedMemo) {
        return { verified: false };
      }

      const ops = await this.callHorizon(() => tx.operations());
      for (const op of ops.records as unknown as HorizonPaymentRecord[]) {
        if (op.type === 'payment') {
          const isUsdc = op.asset_code === 'USDC' && op.asset_issuer === this.usdcAsset.getIssuer();
          const isXlm = op.asset_type === 'native';

          if (isUsdc || isXlm) {
            const amount = parseFloat(op.amount);
            return { verified: true, amount, asset: isUsdc ? 'USDC' : 'XLM', from: op.from };
          }
        }
      }

      return { verified: false };
    } catch {
      return { verified: false };
    }
  }

  async sendPayment(
    destinationId: string,
    amount: string,
    asset: StellarSdk.Asset,
    memo?: string,
  ): Promise<string> {
    return this.stellarTxQueue.submitPayment(destinationId, amount, asset, memo);
  }

  getUsdcAsset(): StellarSdk.Asset {
    return this.usdcAsset;
  }

  /**
   * Build the asset_type argument for the payment_escrow deposit invocation.
   * Returns the ScVal enum variant expected by the Soroban contract.
   */
  buildAssetTypeScVal(assetType: 'XLM' | 'USDC'): StellarSdk.xdr.ScVal {
    return StellarSdk.xdr.ScVal.scvVec([StellarSdk.xdr.ScVal.scvSymbol(assetType)]);
  }

  getServer(): StellarSdk.Horizon.Server {
    return this.server;
  }

  async getBalance(stellarAccountId: string): Promise<HorizonBalance[]> {
    const account = await this.callHorizon(() => this.server.accounts().accountId(stellarAccountId).call());
    return account.balances as unknown as HorizonBalance[];
  }

  async invokeContract(fn: string, args: unknown[] = []): Promise<string> {
    if (!this.sorobanContractId) {
      throw new SorobanRpcException(
        'SOROBAN_CONTRACT_ID is not configured',
        'missing_contract_id',
        HttpStatus.INTERNAL_SERVER_ERROR,
        fn,
        args,
      );
    }
    if (!this.keypair) {
      throw new SorobanRpcException(
        'STELLAR_ACCOUNT_SECRET is not configured',
        'missing_signer',
        HttpStatus.INTERNAL_SERVER_ERROR,
        fn,
        args,
      );
    }

    try {
      const source = await this.callHorizon(() => this.server.loadAccount(this.keypair.publicKey()));
      const contract = new StellarSdk.Contract(this.sorobanContractId);
      const tx = new StellarSdk.TransactionBuilder(source, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(fn, ...args.map((arg) => StellarSdk.nativeToScVal(arg))))
        .setTimeout(30)
        .build();

      const simulated = await this.sorobanRpc.call('simulate transaction', (rpc) => rpc.simulateTransaction(tx));
      if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
        throw new SorobanRpcException(
          'Soroban simulateTransaction failed',
          this.extractSorobanErrorCode(simulated.error),
          HttpStatus.BAD_REQUEST,
          fn,
          args,
        );
      }

      const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simulated).build();
      preparedTx.sign(this.keypair);

      const submitted = await this.sorobanRpc.call('submit transaction', (rpc) => rpc.sendTransaction(preparedTx));
      if (submitted.status !== 'PENDING') {
        throw new SorobanRpcException(
          'Soroban sendTransaction failed',
          this.extractSorobanErrorCode(submitted.errorResult ?? submitted),
          HttpStatus.BAD_GATEWAY,
          fn,
          args,
        );
      }

      return submitted.hash;
    } catch (error) {
      if (error instanceof SorobanRpcException) {
        throw error;
      }

      throw new SorobanRpcException(
        `Soroban contract invocation failed for ${fn}`,
        this.extractSorobanErrorCode(error),
        HttpStatus.BAD_GATEWAY,
        fn,
        args,
      );
    }
  }

  private extractSorobanErrorCode(error: unknown): string | undefined {
    if (!error) return undefined;
    if (typeof error === 'string') return error;
    if (typeof error === 'object') {
      const anyError = error as Record<string, any>;
      if (typeof anyError.message === 'string') return anyError.message;
      if (typeof anyError.error === 'string') return anyError.error;
    }
    return undefined;
  }
}
