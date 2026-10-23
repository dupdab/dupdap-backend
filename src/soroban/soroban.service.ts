import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { SorobanRpcResilience } from '../stellar/soroban-rpc-resilience';

export const SOROBAN_RPC_CLIENT = 'SOROBAN_RPC_CLIENT';
/** Optional second RPC client built from `SOROBAN_RPC_FALLBACK_URL`. */
export const SOROBAN_RPC_FALLBACK_CLIENT = 'SOROBAN_RPC_FALLBACK_CLIENT';

type SorobanRpcClient = {
  getAccount(address: string): Promise<any>;
  getNetwork(): Promise<{ passphrase?: string }>;
  pollTransaction(hash: string, options?: Record<string, unknown>): Promise<any>;
  prepareTransaction?(transaction: any): Promise<any>;
  sendTransaction(transaction: any): Promise<any>;
  simulateTransaction(transaction: any): Promise<any>;
};

export interface InvokeContractOptions {
  contractId: string;
  method: string;
  args?: unknown[];
  fee?: string;
  readOnly?: boolean;
  secretKey?: string;
  sourcePublicKey?: string;
  timeoutInSeconds?: number;
}

/** Optional SDK helpers that are absent from partial SDK mocks and older versions. */
interface SdkAssembleTransaction {
  assembleTransaction?: (transaction: unknown, simulation: unknown) => { build?: () => unknown } | undefined;
}
interface SdkScValToNative {
  scValToNative?: (scVal: StellarSdk.xdr.ScVal) => unknown;
}
interface SdkNativeToScVal {
  nativeToScVal?: (value: unknown) => unknown;
}
interface XdrSwitchLike {
  switch?: () => { name?: string };
}
interface XdrTransactionResultLike extends XdrSwitchLike {
  result?: unknown;
}

@Injectable()
export class SorobanService implements OnModuleInit {
  private readonly logger = new Logger(SorobanService.name);
  private networkPassphrase?: string;
  private readonly rpc: SorobanRpcResilience<SorobanRpcClient>;

  constructor(
    private readonly configService: ConfigService,
    @Inject(SOROBAN_RPC_CLIENT)
    private readonly rpcClient: SorobanRpcClient,
    @Optional()
    @Inject(SOROBAN_RPC_FALLBACK_CLIENT)
    fallbackClient?: SorobanRpcClient,
    @Optional()
    private readonly adminAlerts?: AdminAlertService,
  ) {
    this.rpc = new SorobanRpcResilience<SorobanRpcClient>(rpcClient, fallbackClient, {
      name: 'soroban-rpc',
      isRetryable: (error) => this.isRetryable(error),
      onCircuitOpen: (failures) => {
        void this.adminAlerts
          ?.raise({
            type: AdminAlertType.STELLAR_MONITOR,
            dedupeKey: 'soroban-rpc-circuit',
            message: `Soroban RPC circuit breaker opened after ${failures} consecutive failures; payment operations will fail fast until it recovers.`,
            metadata: { failures, fallbackConfigured: fallbackClient !== undefined },
            thresholdValue: failures,
          })
          .catch((error) =>
            this.logger.error(`Failed to raise Soroban circuit alert: ${this.describeError(error)}`),
          );
      },
    });
  }

  async onModuleInit(): Promise<void> {
    this.networkPassphrase = await this.getNetworkPassphrase();
  }

  getClient(): SorobanRpcClient {
    return this.rpcClient;
  }

  async simulateTx(transaction: any): Promise<any> {
    try {
      const simulation = await this.withRetry(
        (client) => client.simulateTransaction(transaction),
        'simulate transaction',
      );

      if (simulation?.error) {
        this.logger.warn(`Soroban simulation failed: ${this.describeSimulationError(simulation)}`);
        throw new BadRequestException({
          errorCode: 'BLOCKCHAIN_OPERATION_FAILED',
          message:
            'The blockchain rejected this request. Check the payment details and wallet permissions before retrying.',
        });
      }

      return simulation;
    } catch (error) {
      throw this.translateRpcError(error, 'simulate transaction');
    }
  }

  async submitTx(transaction: any, signer?: StellarSdk.Keypair | string): Promise<any> {
    try {
      const preparedTransaction = await this.prepareTransaction(transaction);
      this.signTransaction(preparedTransaction, signer);

      const submission = await this.withRetry(
        (client) => client.sendTransaction(preparedTransaction),
        'submit transaction',
      );

      if (!submission?.hash) {
        throw new BadGatewayException('Soroban RPC did not return a transaction hash');
      }

      const finalResponse = await this.withRetry(
        (client) =>
          client.pollTransaction(submission.hash, {
            attempts: 5,
            sleep: 1000,
          }),
        'poll transaction',
      );

      const status = String(finalResponse?.status ?? submission?.status ?? '').toUpperCase();

      if (status && status !== 'SUCCESS') {
        this.logger.warn(
          `Soroban transaction failed: ${this.describeTransactionFailure(finalResponse ?? submission)}`,
        );
        throw new BadRequestException({
          errorCode: 'BLOCKCHAIN_OPERATION_FAILED',
          message:
            'The blockchain transaction did not complete. Check the payment status before retrying.',
        });
      }

      return finalResponse ?? submission;
    } catch (error) {
      throw this.translateRpcError(error, 'submit transaction');
    }
  }

  async invokeContract(options: InvokeContractOptions): Promise<any> {
    const sourcePublicKey =
      options.sourcePublicKey ?? this.resolveSourcePublicKey(options.secretKey);
    const account = await this.withRetry(
      (client) => client.getAccount(sourcePublicKey),
      'load source account',
    );
    const contract = new StellarSdk.Contract(options.contractId);
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: options.fee ?? String(StellarSdk.BASE_FEE),
      networkPassphrase: await this.getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(options.method, ...(options.args ?? []).map((value) => this.toScVal(value))),
      )
      .setTimeout(options.timeoutInSeconds ?? 30)
      .build();

    if (options.readOnly) {
      const simulation = await this.simulateTx(transaction);
      return {
        transaction,
        simulation,
        result: this.parseSimulationResult(simulation),
      };
    }

    const response = await this.submitTx(transaction, options.secretKey);
    return { transaction, response };
  }

  async registerUser(username: string, publicKey: string): Promise<void> {
    await this.invokeConfiguredContract('registerUser', [username, publicKey]);
  }

  async getBalance(stellarAddress: string): Promise<string> {
    const result = await this.invokeConfiguredContract('getBalance', [stellarAddress], {
      readOnly: true,
    });
    return this.stringifyContractResult(result.result);
  }

  async getStakeBalance(stellarAddress: string): Promise<string> {
    const result = await this.invokeConfiguredContract('getStakeBalance', [stellarAddress], {
      readOnly: true,
    });
    return this.stringifyContractResult(result.result);
  }

  async deposit(stellarAddress: string, amountUsdc: string): Promise<void> {
    await this.invokeConfiguredContract('deposit', [stellarAddress, amountUsdc]);
  }

  async release(paymentId: string, merchantAddress: string): Promise<void> {
    await this.invokeConfiguredContract('release', [paymentId, merchantAddress]);
  }

  async refund(paymentId: string, customerAddress: string): Promise<void> {
    await this.invokeConfiguredContract('refund', [paymentId, customerAddress]);
  }

  private async invokeConfiguredContract(
    method: string,
    args: unknown[],
    options: Partial<InvokeContractOptions> = {},
  ): Promise<any> {
    const contractId = this.configService.get<string>('SOROBAN_CONTRACT_ID');
    if (!contractId) {
      throw new ServiceUnavailableException('SOROBAN_CONTRACT_ID is not configured');
    }

    return this.invokeContract({
      contractId,
      method,
      args,
      readOnly: options.readOnly,
      fee: options.fee,
      secretKey: options.secretKey,
      sourcePublicKey: options.sourcePublicKey,
      timeoutInSeconds: options.timeoutInSeconds,
    });
  }

  private async prepareTransaction(transaction: any): Promise<any> {
    if (typeof this.rpcClient.prepareTransaction === 'function') {
      return this.withRetry(
        (client) => client.prepareTransaction!(transaction),
        'prepare transaction',
      );
    }

    const simulation = await this.simulateTx(transaction);
    const assembled = (StellarSdk.rpc as unknown as SdkAssembleTransaction)?.assembleTransaction?.(transaction, simulation);

    if (assembled?.build) {
      return assembled.build();
    }

    return assembled ?? transaction;
  }

  private signTransaction(transaction: any, signer?: StellarSdk.Keypair | string): void {
    const resolvedSigner =
      signer ??
      this.configService.get<string>('SOROBAN_SOURCE_SECRET') ??
      this.configService.get<string>('STELLAR_ACCOUNT_SECRET');

    if (!resolvedSigner || typeof transaction?.sign !== 'function') {
      return;
    }

    const keypair =
      typeof resolvedSigner === 'string'
        ? StellarSdk.Keypair.fromSecret(resolvedSigner)
        : resolvedSigner;

    transaction.sign(keypair);
  }

  private resolveSourcePublicKey(secretKey?: string): string {
    const configuredPublicKey =
      this.configService.get<string>('SOROBAN_SOURCE_PUBLIC_KEY') ??
      this.configService.get<string>('STELLAR_ACCOUNT_PUBLIC');

    if (configuredPublicKey) {
      return configuredPublicKey;
    }

    const resolvedSecret =
      secretKey ??
      this.configService.get<string>('SOROBAN_SOURCE_SECRET') ??
      this.configService.get<string>('STELLAR_ACCOUNT_SECRET');

    if (!resolvedSecret) {
      throw new ServiceUnavailableException(
        'Configure SOROBAN_SOURCE_PUBLIC_KEY or SOROBAN_SOURCE_SECRET',
      );
    }

    return StellarSdk.Keypair.fromSecret(resolvedSecret).publicKey();
  }

  private async getNetworkPassphrase(): Promise<string> {
    if (this.networkPassphrase) {
      return this.networkPassphrase;
    }

    const explicitPassphrase = this.configService.get<string>('SOROBAN_NETWORK_PASSPHRASE');
    if (explicitPassphrase) {
      this.networkPassphrase = explicitPassphrase;
      return explicitPassphrase;
    }

    const network = this.configService.get<string>('STELLAR_NETWORK', 'TESTNET');
    if (network === 'PUBLIC') {
      this.networkPassphrase = StellarSdk.Networks.PUBLIC;
      return this.networkPassphrase;
    }

    if (network === 'TESTNET') {
      this.networkPassphrase = StellarSdk.Networks.TESTNET;
      return this.networkPassphrase;
    }

    const networkDetails = await this.withRetry(
      (client) => client.getNetwork(),
      'load network details',
    );
    this.networkPassphrase = networkDetails?.passphrase ?? StellarSdk.Networks.TESTNET;

    return this.networkPassphrase;
  }

  private parseSimulationResult(simulation: any): unknown {
    const rawValue =
      simulation?.result?.retval ??
      simulation?.result?.xdr ??
      simulation?.results?.[0]?.retval ??
      simulation?.results?.[0]?.xdr;

    if (!rawValue || typeof rawValue !== 'string') {
      return null;
    }

    return this.decodeScVal(rawValue) ?? rawValue;
  }

  private stringifyContractResult(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (value == null) {
      return '0';
    }

    return JSON.stringify(value);
  }

  private describeSimulationError(simulation: any): string {
    return (
      this.decodeXdrValue(simulation?.error) ??
      this.decodeXdrValue(simulation?.resultErrorXdr) ??
      this.describeError(simulation?.error) ??
      this.describeError(simulation)
    );
  }

  private describeTransactionFailure(result: any): string {
    return (
      this.decodeXdrValue(result?.errorResultXdr) ??
      this.decodeXdrValue(result?.resultXdr) ??
      this.describeError(result?.error) ??
      this.describeError(result)
    );
  }

  private decodeScVal(rawValue: string): unknown | null {
    try {
      const scVal = StellarSdk.xdr.ScVal.fromXDR(rawValue, 'base64');
      const nativeValue = (StellarSdk as unknown as SdkScValToNative).scValToNative?.(scVal);
      return nativeValue ?? scVal.toXDR('base64');
    } catch {
      return null;
    }
  }

  private decodeXdrValue(rawValue: unknown): string | null {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return null;
    }

    const scVal = this.decodeScVal(rawValue);
    if (scVal != null) {
      return this.stringifyContractResult(scVal);
    }

    try {
      const txResult = StellarSdk.xdr.TransactionResult.fromXDR(rawValue, 'base64') as unknown as XdrTransactionResultLike;
      const rawResult = txResult?.result;
      const txResultValue = (
        typeof rawResult === 'function' ? (rawResult as () => XdrSwitchLike | undefined)() : rawResult
      ) as XdrSwitchLike | undefined;
      const resultCode = txResultValue?.switch?.().name ?? txResult?.switch?.().name;

      if (resultCode) {
        return `transaction_result:${resultCode}`;
      }
    } catch {
      // Try the next decoding strategy.
    }

    try {
      const decoded = Buffer.from(rawValue, 'base64').toString('utf8').trim();
      if (decoded) {
        return decoded;
      }
    } catch {
      // Fall through to raw value.
    }

    return rawValue;
  }

  private translateRpcError(error: unknown, action: string): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    const message = this.describeError(error);
    if (this.isRetryable(error)) {
      return new ServiceUnavailableException(
        `Soroban RPC unavailable while trying to ${action}: ${message}`,
      );
    }

    return new BadGatewayException(`Soroban RPC error while trying to ${action}: ${message}`);
  }

  private describeError(error: unknown): string {
    if (!error) {
      return 'Unknown Soroban RPC error';
    }

    if (typeof error === 'string') {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as Record<string, unknown>).message);
    }

    return JSON.stringify(error);
  }

  private isRetryable(error: unknown): boolean {
    const status = Number(
      (error as Record<string, any> | undefined)?.response?.status ??
        (error as Record<string, any> | undefined)?.status,
    );

    if ([408, 429, 500, 502, 503, 504].includes(status)) {
      return true;
    }

    const message = this.describeError(error).toLowerCase();
    return [
      'timeout',
      'temporarily unavailable',
      'network',
      'socket hang up',
      'econnreset',
      'eai_again',
      'etimedout',
      '503',
      '502',
    ].some((fragment) => message.includes(fragment));
  }

  private withRetry<T>(
    operation: (client: SorobanRpcClient) => Promise<T>,
    action: string,
  ): Promise<T> {
    return this.rpc.call(action, operation);
  }

  private toScVal(value: unknown): StellarSdk.xdr.ScVal {
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { toXDR?: unknown }).toXDR === 'function'
    ) {
      return value as StellarSdk.xdr.ScVal;
    }

    const nativeToScVal = (StellarSdk as unknown as SdkNativeToScVal).nativeToScVal;
    return typeof nativeToScVal === 'function'
      ? (nativeToScVal(value) as StellarSdk.xdr.ScVal)
      : (value as StellarSdk.xdr.ScVal);
  }
}
