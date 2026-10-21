import * as Sentry from '@sentry/nestjs';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { SorobanRpcException } from '../../stellar/soroban-rpc.exception';

jest.mock('@sentry/nestjs', () => ({
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
        getResponse: () => ({ status, setHeader: jest.fn() }),
      }),
    } as never;

    filter.catch(exception, host);

    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
    const scope = (Sentry.withScope as jest.Mock).mock.calls[0][0];
    // Re-run callback with a spy scope to verify tags/context/breadcrumb
    const spy = {
      setUser: jest.fn(),
      setContext: jest.fn(),
      setTag: jest.fn(),
      addBreadcrumb: jest.fn(),
    };
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

import { BadRequestException, HttpException, InternalServerErrorException } from '@nestjs/common';

describe('AllExceptionsFilter public error contract', () => {
  function render(exception: unknown) {
    const filter = new AllExceptionsFilter({} as never, { get: jest.fn() } as never);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    filter.catch(exception, {
      switchToHttp: () => ({
        getRequest: () => ({ url: '/api/payments', method: 'POST' }),
        getResponse: () => ({ status }),
      }),
    } as never);
    return { body: json.mock.calls[0][0], status };
  }

  it.each([
    new TypeError("Cannot read properties of undefined (reading 'secret')"),
    new InternalServerErrorException('SQL password=private'),
    'raw unexpected failure',
  ])('keeps internal diagnostics out of public responses: %p', (exception) => {
    const { body, status } = render(exception);
    expect(status).toHaveBeenCalledWith(500);
    expect(body).toEqual(
      expect.objectContaining({
        errorCode: 'INTERNAL_ERROR',
        message: expect.stringContaining('Try again later'),
        path: '/api/payments',
        timestamp: expect.any(String),
      }),
    );
    expect(JSON.stringify(body)).not.toMatch(/secret|password|SQL|undefined|raw unexpected/);
  });

  it('preserves field validation arrays and adds a code', () => {
    expect(render(new BadRequestException(['amount must be positive'])).body).toEqual(
      expect.objectContaining({
        errorCode: 'INVALID_REQUEST',
        message: ['amount must be positive'],
      }),
    );
  });

  it('preserves explicit domain codes', () => {
    expect(
      render(
        new BadRequestException({
          errorCode: 'PAYMENT_EXPIRED',
          message: 'Create a new payment.',
        }),
      ).body,
    ).toEqual(
      expect.objectContaining({
        errorCode: 'PAYMENT_EXPIRED',
        message: 'Create a new payment.',
      }),
    );
  });

  it.each([401, 403, 404, 409, 410, 413, 429, 502, 503, 504])(
    'returns a stable code for HTTP %s',
    (status) => {
      expect(render(new HttpException('Intentional message', status)).body.errorCode).toMatch(
        /^[A-Z][A-Z0-9_]+$/,
      );
    },
  );

  it('redacts Soroban diagnostics for client failures too', () => {
    expect(render(new SorobanRpcException('XDR internal payload', 'raw secret', 400)).body).toEqual(
      expect.objectContaining({
        errorCode: 'BLOCKCHAIN_OPERATION_FAILED',
        message: expect.stringContaining('Check the payment status'),
      }),
    );
  });
});
