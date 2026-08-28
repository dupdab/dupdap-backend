import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { AmlController } from './aml.controller';
import { AmlService } from './aml.service';
import { AmlFlagStatus } from './entities/aml-flag.entity';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

describe('AmlController', () => {
  let controller: AmlController;
  let service: jest.Mocked<Pick<AmlService, 'findAll' | 'findPending' | 'findByMerchant' | 'review'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AmlController],
      providers: [
        {
          provide: AmlService,
          useValue: { findAll: jest.fn(), findPending: jest.fn(), findByMerchant: jest.fn(), review: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get(AmlController);
    service = module.get(AmlService);
  });

  it('requires JwtAuthGuard on the controller', () => {
    expect(Reflect.getMetadata('__guards__', AmlController)).toContain(JwtAuthGuard);
  });

  it('delegates findAll with numeric pagination', async () => {
    service.findAll.mockResolvedValue({ flags: [], total: 0, page: 2, limit: 10 });
    await expect(controller.findAll('2' as any, '10' as any)).resolves.toEqual({ flags: [], total: 0, page: 2, limit: 10 });
    expect(service.findAll).toHaveBeenCalledWith(2, 10);
  });

  it('delegates findPending with numeric pagination', async () => {
    service.findPending.mockResolvedValue({ flags: [], total: 0, page: 1, limit: 20 });
    await controller.findPending();
    expect(service.findPending).toHaveBeenCalledWith(1, 20);
  });

  it('delegates findByMerchant', async () => {
    service.findByMerchant.mockResolvedValue([]);
    await controller.findByMerchant('merchant-1');
    expect(service.findByMerchant).toHaveBeenCalledWith('merchant-1');
  });

  it('delegates review with DTO fields', async () => {
    const dto = { status: AmlFlagStatus.CLEARED, reviewedBy: 'admin-1', note: 'Reviewed' };
    service.review.mockResolvedValue({ id: 'flag-1' } as any);
    await controller.review('flag-1', dto);
    expect(service.review).toHaveBeenCalledWith('flag-1', dto.status, dto.reviewedBy, dto.note);
  });
});
