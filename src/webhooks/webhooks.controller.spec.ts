import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: jest.Mocked<Pick<WebhooksService, 'findAll' | 'create' | 'remove'>>;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      create: jest.fn(),
      remove: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: WebhooksService, useValue: service },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WebhooksController);
  });

  it('findAll requires the webhooks:manage scope and delegates with the authenticated merchant id', async () => {
    const req = { user: { merchantId: 'merchant-1' } } as any;
    service.findAll.mockResolvedValue([{ id: 'hook-1' }]);

    await expect(controller.findAll(req)).resolves.toEqual([{ id: 'hook-1' }]);
    expect(service.findAll).toHaveBeenCalledWith('merchant-1');
    expect(Reflect.getMetadata('scopes', WebhooksController.prototype.findAll)).toContain('webhooks:manage');
  });

  it('create requires the webhooks:manage scope and delegates with the authenticated merchant id', async () => {
    const req = { user: { merchantId: 'merchant-1' } } as any;
    const dto = { url: 'https://example.com/hook', events: ['payment.completed'], secret: 'top-secret' } as any;
    service.create.mockResolvedValue({ id: 'hook-1' });

    await expect(controller.create(req, dto)).resolves.toEqual({ id: 'hook-1' });
    expect(service.create).toHaveBeenCalledWith('merchant-1', dto.url, dto.events, dto.secret);
    expect(Reflect.getMetadata('scopes', WebhooksController.prototype.create)).toContain('webhooks:manage');
  });

  it('remove requires the webhooks:manage scope and delegates with the authenticated merchant id', async () => {
    const req = { user: { merchantId: 'merchant-1' } } as any;
    service.remove.mockResolvedValue({ id: 'hook-1' });

    await expect(controller.remove(req, 'hook-1')).resolves.toEqual({ id: 'hook-1' });
    expect(service.remove).toHaveBeenCalledWith('hook-1', 'merchant-1');
    expect(Reflect.getMetadata('scopes', WebhooksController.prototype.remove)).toContain('webhooks:manage');
  });

  it('requires the JWT guard on the controller', () => {
    expect(Reflect.getMetadata('__guards__', WebhooksController)).toContain(JwtAuthGuard);
  });
});
