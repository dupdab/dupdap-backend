import * as Sentry from '@sentry/node';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { SorobanRpcException } from '../../stellar/stellar.service';

jest.mock('@sentry/node', () => ({
  withScope: jest.fn((cb: (scope: unknown) => void) =>
    cb({
      setUser: jest.fn(),
      setContext: jest.fn(),
      setTag: jest.fn(),
      addBreadcrumb: jest.fn(),
    }),
  ),
  captureException: jest.fn(),
}));

describe('AllExceptionsFilter (SorobanRpcException)', () => {
  it('tags Sentry event with blockchain context and RPC breadcrumb', () => {
    const filter = new AllExceptionsFilter(
      { getHttpAdapter: jest.fn() } as never,
      { get: jest.fn().mockReturnValue('dsn') } as never,
    );
    const exception = new SorobanRpcException(
      'Soroban sendTransaction failed',
      'send-failed',
      502,
      'deposit',
      ['arg1'],
    );
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ url: '/test', method: 'POST' }),
        getResponse: () => ({ status }),
      }),
    } as never;

    filter.catch(exception, host);

    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
    const scope = (Sentry.withScope as jest.Mock).mock.calls[0][0];
    // Re-run callback with a spy scope to verify tags/context/breadcrumb
    const spy = { setUser: jest.fn(), setContext: jest.fn(), setTag: jest.fn(), addBreadcrumb: jest.fn() };
    scope(spy);
    expect(spy.setTag).toHaveBeenCalledWith('blockchain', 'stellar-soroban');
    expect(spy.setContext).toHaveBeenCalledWith(
      'soroban',
      expect.objectContaining({ rpcMethod: 'deposit' }),
    );
    expect(spy.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'soroban.rpc' }),
    );
  });
});
