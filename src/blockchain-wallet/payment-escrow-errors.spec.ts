import {
  ContractPausedError,
  PaymentExpiredError,
  ReentrantCallError,
} from './payment-escrow.service';

describe('Escrow public errors', () => {
  it('retains expiry context privately and returns recovery instructions', () => {
    const error = new PaymentExpiredError('payment-1', 100, 101);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      errorCode: 'PAYMENT_EXPIRED',
      message: 'This payment has expired. Create a new payment to continue.',
    });
    expect(error).toMatchObject({ paymentId: 'payment-1', expiryLedger: 100, currentLedger: 101 });
  });

  it.each([
    [new ContractPausedError(), 403, 'ESCROW_PAUSED'],
    [new ReentrantCallError(), 409, 'ESCROW_OPERATION_IN_PROGRESS'],
  ])('gives escrow state errors HTTP status and a stable code', (error, status, code) => {
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toEqual(expect.objectContaining({ errorCode: code }));
  });
});
