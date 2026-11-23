import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentsSorobanListener } from './payments-soroban.listener';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentConfirmedEventDto } from '../stellar/soroban-event.dto';

describe('PaymentsSorobanListener', () => {
  let listener: PaymentsSorobanListener;
  let execute: jest.Mock;

  const event: PaymentConfirmedEventDto = {
    eventId: 'event-1',
    pagingToken: 'token-1',
    ledger: 100,
    ledgerClosedAt: new Date('2026-01-01T00:00:00Z'),
    contractId: 'CABC',
    rawTopic: ['payment.confirmed'],
    topic: 'payment.confirmed',
    paymentReference: 'PAY-123',
    txHash: 'tx-hash-1',
    amount: 100,
    asset: 'USDC',
  };

  beforeEach(async () => {
    execute = jest.fn();
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsSorobanListener,
        {
          provide: getRepositoryToken(Payment),
          useValue: { createQueryBuilder: jest.fn(() => queryBuilder) },
        },
      ],
    }).compile();

    listener = module.get(PaymentsSorobanListener);
  });

  it('confirms the payment with a conditional UPDATE', async () => {
    execute.mockResolvedValue({ affected: 1 });

    await listener.handlePaymentConfirmed(event);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('discards duplicate events when the conditional UPDATE affects no rows', async () => {
    execute.mockResolvedValue({ affected: 0 });

    await expect(listener.handlePaymentConfirmed(event)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('applies only one of two concurrent duplicate events', async () => {
    // Simulates the database: the first UPDATE wins, the second matches no row.
    let confirmed = false;
    execute.mockImplementation(async () => {
      if (confirmed) {
        return { affected: 0 };
      }
      confirmed = true;
      return { affected: 1 };
    });

    await Promise.all([
      listener.handlePaymentConfirmed(event),
      listener.handlePaymentConfirmed({ ...event, eventId: 'event-2' }),
    ]);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(confirmed).toBe(true);
  });
});
