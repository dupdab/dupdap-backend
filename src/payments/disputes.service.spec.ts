import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { DisputeStatus } from './entities/payment-dispute.entity';

describe('DisputesService', () => {
  const payment = { id: 'payment-1', merchantId: 'merchant-1', customerEmail: 'buyer@example.com' };
  let service: DisputesService;
  let disputeRepo: any;
  let paymentRepo: any;

  beforeEach(() => {
    disputeRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    paymentRepo = { findOne: jest.fn(async () => payment) };
    service = new DisputesService(disputeRepo, paymentRepo, { raise: jest.fn() } as any, { resumeAfterDisputeResolution: jest.fn() } as any);
  });

  it('opens a merchant dispute with the configured 48 hour SLA', async () => {
    disputeRepo.findOne.mockResolvedValue(null);
    const before = Date.now();
    const result = await service.raise(payment.id, payment.merchantId, undefined, 'Payment not received');
    expect(result.status).toBe(DisputeStatus.OPEN);
    expect(result.slaDeadline.getTime()).toBeGreaterThanOrEqual(before + 47 * 60 * 60 * 1000);
    expect(result.slaDeadline.getTime()).toBeLessThanOrEqual(Date.now() + 49 * 60 * 60 * 1000);
  });

  it('allows a customer who matches the payment email to raise a dispute', async () => {
    disputeRepo.findOne.mockResolvedValue(null);
    await service.raise(payment.id, undefined, payment.customerEmail, 'Charged twice');
    expect(disputeRepo.create).toHaveBeenCalledWith(expect.objectContaining({ raisedBy: payment.customerEmail }));
  });

  it('does not reveal payments to a non-owner customer', async () => {
    paymentRepo.findOne.mockResolvedValue({ ...payment, customerEmail: 'different@example.com' });
    await expect(service.raise(payment.id, undefined, 'buyer@example.com', 'Dispute')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate open disputes and empty reasons', async () => {
    disputeRepo.findOne.mockResolvedValue({ id: 'existing' });
    await expect(service.raise(payment.id, payment.merchantId, undefined, 'duplicate')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.raise(payment.id, payment.merchantId, undefined, '  ')).rejects.toBeInstanceOf(BadRequestException);
  });
});
