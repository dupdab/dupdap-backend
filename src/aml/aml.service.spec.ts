import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { AmlService } from './aml.service';
import { AmlFlag, AmlFlagReason, AmlFlagStatus } from './entities/aml-flag.entity';
import { Payment } from '../payments/entities/payment.entity';
import { NotificationsService } from '../notifications/notifications.service';

describe('AmlService', () => {
  let service: AmlService;
  let amlRepo: jest.Mocked<Partial<Repository<AmlFlag>>>;
  let paymentsRepo: jest.Mocked<Partial<Repository<Payment>>>;
  let notifications: jest.Mocked<NotificationsService>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AmlService,
        { provide: getRepositoryToken(AmlFlag), useValue: { create: jest.fn(), save: jest.fn(), findAndCount: jest.fn(), findOne: jest.fn(), find: jest.fn() } },
        { provide: getRepositoryToken(Payment), useValue: { count: jest.fn() } },
        { provide: NotificationsService, useValue: { enqueueEmail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(AmlService);
    amlRepo = module.get(getRepositoryToken(AmlFlag));
    paymentsRepo = module.get(getRepositoryToken(Payment));
    notifications = module.get(NotificationsService);
    config = module.get(ConfigService);
    amlRepo.create!.mockImplementation((value: any) => value);
    amlRepo.save!.mockImplementation(async (value: any) => value);
    config.get.mockReturnValue('admin@example.com');
    paymentsRepo.count!.mockResolvedValue(0);
  });

  describe('checkAndFlag', () => {
    it('flags a payment at the high-value threshold and notifies the admin', async () => {
      await service.checkAndFlag({ id: 'p1', merchantId: 'm1', amountUsd: 10000 } as any);

      expect(amlRepo.create).toHaveBeenCalledWith({ merchantId: 'm1', paymentId: 'p1', reason: AmlFlagReason.HIGH_VALUE, metadata: { amountUsd: 10000 } });
      expect(amlRepo.save).toHaveBeenCalledTimes(1);
      expect(notifications.enqueueEmail).toHaveBeenCalledWith(expect.objectContaining({ recipient: 'admin@example.com', subject: `[AML Alert] New flag: ${AmlFlagReason.HIGH_VALUE}` }));
    });

    it('does not flag a payment below the high-value threshold', async () => {
      await service.checkAndFlag({ id: 'p1', merchantId: 'm1', amountUsd: 9999.99 } as any);
      expect(amlRepo.save).not.toHaveBeenCalled();
      expect(notifications.enqueueEmail).not.toHaveBeenCalled();
    });

    it('flags high velocity only when daily payments exceed the limit', async () => {
      paymentsRepo.count!.mockResolvedValue(51);
      await service.checkAndFlag({ id: 'p1', merchantId: 'm1', amountUsd: 10 } as any);

      expect(amlRepo.create).toHaveBeenCalledWith(expect.objectContaining({ reason: AmlFlagReason.HIGH_VELOCITY, metadata: { dailyCount: 51 } }));
      expect(notifications.enqueueEmail).toHaveBeenCalledTimes(1);
      expect(paymentsRepo.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ merchantId: 'm1', createdAt: expect.anything() }) }));
    });

    it('does not flag high velocity at or below the limit', async () => {
      paymentsRepo.count!.mockResolvedValue(50);
      await service.checkAndFlag({ id: 'p1', merchantId: 'm1', amountUsd: 10 } as any);
      expect(amlRepo.save).not.toHaveBeenCalled();
    });

    it('creates separate flags when both thresholds are exceeded', async () => {
      paymentsRepo.count!.mockResolvedValue(51);
      await service.checkAndFlag({ id: 'p1', merchantId: 'm1', amountUsd: 15000 } as any);
      expect(amlRepo.save).toHaveBeenCalledTimes(2);
      expect(notifications.enqueueEmail).toHaveBeenCalledTimes(2);
    });
  });

  it('finds all flags with pagination', async () => {
    amlRepo.findAndCount!.mockResolvedValue([['flag'] as any, 1]);
    await expect(service.findAll(2, 10)).resolves.toEqual({ flags: ['flag'], total: 1, page: 2, limit: 10 });
    expect(amlRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
  });

  it('finds pending flags with pagination', async () => {
    amlRepo.findAndCount!.mockResolvedValue([[], 0]);
    await expect(service.findPending()).resolves.toEqual({ flags: [], total: 0, page: 1, limit: 20 });
    expect(amlRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { status: AmlFlagStatus.PENDING } }));
  });

  it('finds flags by merchant', async () => {
    amlRepo.find!.mockResolvedValue(['flag'] as any);
    await expect(service.findByMerchant('m1')).resolves.toEqual(['flag']);
    expect(amlRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'm1' } }));
  });

  it('reviews an existing flag', async () => {
    const flag = { id: 'f1' } as AmlFlag;
    amlRepo.findOne!.mockResolvedValue(flag);
    await expect(service.review('f1', AmlFlagStatus.CLEARED, 'admin', 'Checked')).resolves.toBe(flag);
    expect(flag).toEqual(expect.objectContaining({ status: AmlFlagStatus.CLEARED, reviewedBy: 'admin', reviewNote: 'Checked', reviewedAt: expect.any(Date) }));
  });

  it('throws when reviewing a missing flag', async () => {
    amlRepo.findOne!.mockResolvedValue(null);
    await expect(service.review('missing', AmlFlagStatus.CLEARED, 'admin')).rejects.toThrow(NotFoundException);
  });
});
