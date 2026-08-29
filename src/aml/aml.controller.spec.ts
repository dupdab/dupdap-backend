import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { AmlController, ReviewFlagDto } from './aml.controller';
import { AmlService } from './aml.service';
import { AmlFlagStatus } from './entities/aml-flag.entity';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

describe('AmlController', () => {
  let controller: AmlController;
  let service: {
    findAll: jest.Mock;
    findPending: jest.Mock;
    findByMerchant: jest.Mock;
    review: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findPending: jest.fn(),
      findByMerchant: jest.fn(),
      review: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AmlController],
      providers: [{ provide: AmlService, useValue: service }],
    }).compile();

    controller = module.get(AmlController);
  });

  it('delegates findAll with numeric pagination', async () => {
    service.findAll.mockResolvedValue({ flags: [], total: 0 });

    await controller.findAll('2' as any, '10' as any);

    expect(service.findAll).toHaveBeenCalledWith(2, 10);
  });

  it('delegates findPending with numeric pagination', async () => {
    service.findPending.mockResolvedValue({ flags: [], total: 0 });

    await controller.findPending('3' as any, '5' as any);

    expect(service.findPending).toHaveBeenCalledWith(3, 5);
  });

  it('delegates review with the DTO fields', async () => {
    const dto = {
      status: AmlFlagStatus.ESCALATED,
      reviewedBy: 'admin-1',
      note: 'Needs investigation',
    };
    service.review.mockResolvedValue({ id: 'flag-1' });

    await controller.review('flag-1', dto);

    expect(service.review).toHaveBeenCalledWith(
      'flag-1',
      AmlFlagStatus.ESCALATED,
      'admin-1',
      'Needs investigation',
    );
  });

  it('delegates findByMerchant', async () => {
    service.findByMerchant.mockResolvedValue([]);

    await controller.findByMerchant('merchant-1');

    expect(service.findByMerchant).toHaveBeenCalledWith('merchant-1');
  });

  it('requires the JWT auth guard on the controller', () => {
    const guards = Reflect.getMetadata('__guards__', AmlController) ?? [];

    expect(guards).toContain(JwtAuthGuard);
  });

  it('validates review statuses against AmlFlagStatus', async () => {
    const validDto = Object.assign(new ReviewFlagDto(), { status: AmlFlagStatus.CLEARED });
    const invalidDto = Object.assign(new ReviewFlagDto(), { status: 'invalid-status' });

    expect(await validate(validDto)).toHaveLength(0);
    expect(await validate(invalidDto)).not.toHaveLength(0);
  });
});
