import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { SOROBAN_RPC_CLIENT, SorobanService } from './soroban.service';

describe('SorobanService', () => {
  let service: SorobanService;
  let rpcClient: {
    getAccount: jest.Mock;
    getNetwork: jest.Mock;
    pollTransaction: jest.Mock;
    prepareTransaction: jest.Mock;
    sendTransaction: jest.Mock;
    simulateTransaction: jest.Mock;
  };

  const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const SOURCE_PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  function makeAccount() {
    return new StellarSdk.Account(SOURCE_PUBLIC_KEY, '100');
  }

  function makeSuccessfulSubmit(hash = 'txhash') {
    rpcClient.prepareTransaction.mockResolvedValue({ sign: jest.fn() });
    rpcClient.sendTransaction.mockResolvedValue({ hash, status: 'PENDING' });
    rpcClient.pollTransaction.mockResolvedValue({ hash, status: 'SUCCESS' });
  }

  function makeReadOnlyResult(retvalXdr: string | null = null) {
    rpcClient.simulateTransaction.mockResolvedValue({
      latestLedger: 1234,
      result: retvalXdr ? { retval: retvalXdr } : undefined,
    });
  }

  beforeEach(async () => {
    rpcClient = {
      getAccount: jest.fn().mockResolvedValue(makeAccount()),
      getNetwork: jest.fn().mockResolvedValue({ passphrase: StellarSdk.Networks.TESTNET }),
      pollTransaction: jest.fn(),
      prepareTransaction: jest.fn(),
      sendTransaction: jest.fn(),
      simulateTransaction: jest.fn(),
    };

    const config = {
      get: jest.fn((key: string, fallback?: any) => {
        const values: Record<string, any> = {
          SOROBAN_CONTRACT_ID: CONTRACT_ID,
          SOROBAN_SOURCE_PUBLIC_KEY: SOURCE_PUBLIC_KEY,
          STELLAR_NETWORK: 'TESTNET',
        };
        return values[key] ?? fallback;
      }),
    } as unknown as ConfigService;
    service = new SorobanService(config, rpcClient);
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
  });

  // ─── simulateTx ────────────────────────────────────────────────────────────

  it('retries simulation on transient RPC failures', async () => {
    rpcClient.simulateTransaction
      .mockRejectedValueOnce(new Error('ECONNRESET from RPC'))
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({ latestLedger: 1234 });

    await expect(service.simulateTx({ id: 'tx' })).resolves.toEqual({
      latestLedger: 1234,
    });
    expect(rpcClient.simulateTransaction).toHaveBeenCalledTimes(3);
  });

  it('returns an actionable simulation error without exposing RPC diagnostics', async () => {
    rpcClient.simulateTransaction.mockResolvedValueOnce({
      error: Buffer.from('contract reverted: unauthorized', 'utf8').toString('base64'),
    });

    await expect(service.simulateTx({ id: 'tx' })).rejects.toMatchObject({
      message: expect.stringContaining('Check the payment details'),
      response: expect.objectContaining({ errorCode: 'BLOCKCHAIN_OPERATION_FAILED' }),
    });
  });

  // ─── submitTx ──────────────────────────────────────────────────────────────

  it('signs, submits, and polls transactions', async () => {
    const fakeTransaction = { sign: jest.fn() };
    const signer = StellarSdk.Keypair.random();

    rpcClient.prepareTransaction.mockResolvedValue(fakeTransaction);
    rpcClient.sendTransaction.mockResolvedValue({ hash: 'abc123', status: 'PENDING' });
    rpcClient.pollTransaction.mockResolvedValue({ hash: 'abc123', status: 'SUCCESS' });

    const result = await service.submitTx(fakeTransaction, signer.secret());

    expect(rpcClient.prepareTransaction).toHaveBeenCalledWith(fakeTransaction);
    expect(fakeTransaction.sign).toHaveBeenCalledTimes(1);
    expect(rpcClient.sendTransaction).toHaveBeenCalledWith(fakeTransaction);
    expect(rpcClient.pollTransaction).toHaveBeenCalledWith('abc123', {
      attempts: 5,
      sleep: 1000,
    });
    expect(result.status).toBe('SUCCESS');
  });

  it('translates sustained RPC outages into ServiceUnavailableException', async () => {
    rpcClient.simulateTransaction.mockRejectedValue(new Error('timeout contacting soroban rpc'));

    await expect(service.simulateTx({ id: 'tx' })).rejects.toThrow(ServiceUnavailableException);
  });

  // ─── deposit ───────────────────────────────────────────────────────────────

  describe('deposit', () => {
    it('invokes the deposit contract function with address and amount', async () => {
      rpcClient.getAccount.mockResolvedValue(makeAccount());
      makeSuccessfulSubmit();

      await service.deposit('GABC...', '100.00');

      expect(rpcClient.getAccount).toHaveBeenCalledWith(SOURCE_PUBLIC_KEY);
      expect(rpcClient.sendTransaction).toHaveBeenCalled();
    });

    it('wraps RPC connectivity errors in ServiceUnavailableException', async () => {
      rpcClient.getAccount.mockRejectedValue(new Error('socket hang up'));

      await expect(service.deposit('GABC...', '100.00')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('wraps non-transient RPC errors in a BadGatewayException', async () => {
      rpcClient.getAccount.mockResolvedValue(makeAccount());
      const { BadGatewayException } = await import('@nestjs/common');
      rpcClient.prepareTransaction.mockResolvedValue({ sign: jest.fn() });
      rpcClient.sendTransaction.mockResolvedValue({ hash: 'h1', status: 'PENDING' });
      rpcClient.pollTransaction.mockResolvedValue({ hash: 'h1', status: 'FAILED' });

      await expect(service.deposit('GABC...', '100.00')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── release ───────────────────────────────────────────────────────────────

  describe('release', () => {
    it('invokes the release contract function with paymentId and merchant address', async () => {
      rpcClient.getAccount.mockResolvedValue(makeAccount());
      makeSuccessfulSubmit();

      await service.release('pay-001', 'GMERCHANT...');

      expect(rpcClient.sendTransaction).toHaveBeenCalled();
    });

    it('wraps RPC connectivity errors in ServiceUnavailableException', async () => {
      rpcClient.getAccount.mockRejectedValue(new Error('timeout contacting soroban rpc'));

      await expect(service.release('pay-001', 'GMERCHANT...')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ─── refund ────────────────────────────────────────────────────────────────

  describe('refund', () => {
    it('invokes the refund contract function with paymentId and customer address', async () => {
      rpcClient.getAccount.mockResolvedValue(makeAccount());
      makeSuccessfulSubmit();

      await service.refund('pay-002', 'GCUSTOMER...');

      expect(rpcClient.sendTransaction).toHaveBeenCalled();
    });

    it('wraps RPC connectivity errors in ServiceUnavailableException', async () => {
      rpcClient.getAccount.mockRejectedValue(new Error('econnreset'));

      await expect(service.refund('pay-002', 'GCUSTOMER...')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ─── registerUser ──────────────────────────────────────────────────────────

  describe('registerUser', () => {
    it('invokes the registerUser contract function with username and public key', async () => {
      rpcClient.getAccount.mockResolvedValue(makeAccount());
      makeSuccessfulSubmit();

      await service.registerUser('alice', 'GALICE...');

      expect(rpcClient.sendTransaction).toHaveBeenCalled();
    });

    it('throws ServiceUnavailableException when SOROBAN_CONTRACT_ID is not configured', async () => {
      const configWithoutContract = {
        get: jest.fn((key: string, fallback?: any) => {
          if (key === 'SOROBAN_CONTRACT_ID') return undefined;
          if (key === 'SOROBAN_SOURCE_PUBLIC_KEY') return SOURCE_PUBLIC_KEY;
          if (key === 'STELLAR_NETWORK') return 'TESTNET';
          return fallback;
        }),
      } as unknown as ConfigService;

      const svc = new SorobanService(configWithoutContract, rpcClient);
      jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined);

      await expect(svc.registerUser('alice', 'GALICE...')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ─── getBalance ────────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns the balance decoded from the contract simulation result', async () => {
      rpcClient.getAccount.mockResolvedValue(makeAccount());
      // Encode "500" as an XDR ScVal string for a realistic mock
      makeReadOnlyResult(null);

      const balance = await service.getBalance('GABC...');

      // With no retval the service returns '0' (stringifyContractResult of null)
      expect(balance).toBe('0');
    });

    it('wraps RPC errors in ServiceUnavailableException on transient failures', async () => {
      rpcClient.getAccount.mockRejectedValue(new Error('etimedout'));

      await expect(service.getBalance('GABC...')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ─── getStakeBalance ───────────────────────────────────────────────────────

  describe('getStakeBalance', () => {
    it('returns the stake balance from the contract simulation result', async () => {
      rpcClient.getAccount.mockResolvedValue(makeAccount());
      makeReadOnlyResult(null);

      const balance = await service.getStakeBalance('GABC...');

      expect(balance).toBe('0');
    });

    it('wraps RPC errors in ServiceUnavailableException on transient failures', async () => {
      rpcClient.getAccount.mockRejectedValue(new Error('socket hang up'));

      await expect(service.getStakeBalance('GABC...')).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
