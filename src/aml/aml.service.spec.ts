import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AmlService } from './aml.service';
import { AmlFlag, AmlFlagReason, AmlFlagStatus } from './entities/aml-flag.entity';
import { Payment } from '../payments/entities/payment.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';

describe('AmlService', () => {
  let service: AmlService;
  let amlRepo: jest.Mocked<Pick<Repository<AmlFlag>, 'create' | 'save' | 'findAndCount' | 'findOne' | 'find'>>;
  let paymentsRepo: jest.Mocked<Pick<Repository<Payment>, 'count'>>;
  let notifications: jest.Mocked<Pick<NotificationsService, 'enqueueEmail'>>;
  let config: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(async () => {
    amlRepo = {
      create: jest.fn((value) => value as AmlFlag),
      save: jest.fn(async (value) => value as AmlFlag),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    paymentsRepo = { count: jest.fn() };
    notifications = { enqueueEmail: jest.fn() };
    config = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AmlService,
        { provide: getRepositoryToken(AmlFlag), useValue: amlRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepo },
        { provide: NotificationsService, useValue: notifications },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(AmlService);
  });

  describe('checkAndFlag', () => {
    const payment = {
      id: 'payment-1',
      merchantId: 'merchant-1',
      amountUsd: 15_000,
    } as Payment;

    it('creates a high-value flag and notifies the configured admin', async () => {
      config.get.mockReturnValue('admin@example.com');
      paymentsRepo.count.mockResolvedValue(0);

      await service.checkAndFlag(payment);

      expect(amlRepo.create).toHaveBeenCalledWith({
        merchantId: payment.merchantId,
        paymentId: payment.id,
        reason: AmlFlagReason.HIGH_VALUE,
        metadata: { amountUsd: payment.amountUsd },
      });
      expect(amlRepo.save).toHaveBeenCalledTimes(1);
      expect(notifications.enqueueEmail).toHaveBeenCalledWith(expect.objectContaining({
        recipient: 'admin@example.com',
        subject: `[AML Alert] New flag: ${AmlFlagReason.HIGH_VALUE}`,
      }));
    });

    it('creates a high-velocity flag when daily payment count exceeds the limit', async () => {
      config.get.mockReturnValue(undefined);
      paymentsRepo.count.mockResolvedValue(51);

      await service.checkAndFlag({ ...payment, amountUsd: 100 } as Payment);

      expect(amlRepo.create).toHaveBeenCalledWith({
        merchantId: payment.merchantId,
        paymentId: payment.id,
        reason: AmlFlagReason.HIGH_VELOCITY,
        metadata: { dailyCount: 51 },
      });
      expect(amlRepo.save).toHaveBeenCalledTimes(1);
      expect(notifications.enqueueEmail).not.toHaveBeenCalled();
    });

    it('does not create a flag when neither threshold is reached', async () => {
      paymentsRepo.count.mockResolvedValue(50);

      await service.checkAndFlag({ ...payment, amountUsd: 9_999 } as Payment);

      expect(amlRepo.create).not.toHaveBeenCalled();
      expect(amlRepo.save).not.toHaveBeenCalled();
    });
  });

  it('finds all flags with pagination', async () => {
    const flags = [{ id: 'flag-1' }] as AmlFlag[];
    amlRepo.findAndCount.mockResolvedValue([flags, 1]);

    await expect(service.findAll(2, 10)).resolves.toEqual({ flags, total: 1, page: 2, limit: 10 });
    expect(amlRepo.findAndCount).toHaveBeenCalledWith({
      order: { createdAt: 'DESC' },
      skip: 10,
      take: 10,
    });
  });

  it('finds pending flags with pagination', async () => {
    amlRepo.findAndCount.mockResolvedValue([[], 0]);

    await service.findPending(1, 20);

    expect(amlRepo.findAndCount).toHaveBeenCalledWith({
      where: { status: AmlFlagStatus.PENDING },
      order: { createdAt: 'DESC' },
      skip: 0,
      take: 20,
    });
  });

  it('finds flags by merchant', async () => {
    amlRepo.find.mockResolvedValue([]);

    await service.findByMerchant('merchant-1');

    expect(amlRepo.find).toHaveBeenCalledWith({
      where: { merchantId: 'merchant-1' },
      order: { createdAt: 'DESC' },
    });
  });

  it('reviews an existing flag', async () => {
    const flag = { id: 'flag-1', status: AmlFlagStatus.PENDING } as AmlFlag;
    amlRepo.findOne.mockResolvedValue(flag);

    await service.review('flag-1', AmlFlagStatus.CLEARED, 'admin-1', 'Looks good');

    expect(flag).toEqual(expect.objectContaining({
      status: AmlFlagStatus.CLEARED,
      reviewedBy: 'admin-1',
      reviewNote: 'Looks good',
    }));
    expect(flag.reviewedAt).toBeInstanceOf(Date);
    expect(amlRepo.save).toHaveBeenCalledWith(flag);
  });

  it('throws when reviewing a missing flag', async () => {
    amlRepo.findOne.mockResolvedValue(null);

    await expect(service.review('missing', AmlFlagStatus.CLEARED, 'admin-1'))
      .rejects.toThrow(NotFoundException);
    expect(amlRepo.save).not.toHaveBeenCalled();
  });
});
