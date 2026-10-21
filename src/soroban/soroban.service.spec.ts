import { ServiceUnavailableException } from '@nestjs/common';
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

  beforeEach(async () => {
    rpcClient = {
      getAccount: jest.fn(),
      getNetwork: jest.fn().mockResolvedValue({ passphrase: StellarSdk.Networks.TESTNET }),
      pollTransaction: jest.fn(),
      prepareTransaction: jest.fn(),
      sendTransaction: jest.fn(),
      simulateTransaction: jest.fn(),
    };

    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          SOROBAN_CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
          SOROBAN_SOURCE_PUBLIC_KEY: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          STELLAR_NETWORK: 'TESTNET',
        };
        return values[key] ?? fallback;
      }),
    } as unknown as ConfigService;
    service = new SorobanService(config, rpcClient);
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
  });

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

  it('signs, submits, and polls transactions', async () => {
    const fakeTransaction = { sign: jest.fn() };
    const signer = StellarSdk.Keypair.random();

    rpcClient.prepareTransaction.mockResolvedValue(fakeTransaction);
    rpcClient.sendTransaction.mockResolvedValue({ hash: 'abc123', status: 'PENDING' });
    rpcClient.pollTransaction.mockResolvedValue({
      hash: 'abc123',
      status: 'SUCCESS',
    });

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
});
