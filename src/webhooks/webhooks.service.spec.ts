import { NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { Webhook } from './entities/webhook.entity';
import { WebhookDeliveryService } from './webhook-delivery.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let webhooksRepo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
  };
  let webhookDelivery: { enqueueDelivery: jest.Mock };
  let merchantsRepo: { findOne: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    webhooksRepo = {
      find: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(),
      remove: jest.fn(async (value) => value),
    };

    webhookDelivery = { enqueueDelivery: jest.fn() };
    merchantsRepo = { findOne: jest.fn(), save: jest.fn(async (value) => value) };

    service = new WebhooksService(
      webhooksRepo as any,
      webhookDelivery as any,
      undefined,
      undefined,
      merchantsRepo as any,
    );
  });

  it('creates a webhook with a generated secret when one is not supplied', async () => {
    const saved = { id: 'hook-1', merchantId: 'merchant-1', url: 'https://example.com/api', events: ['payment.completed'] } as any;
    webhooksRepo.save.mockResolvedValue(saved);

    const result = await service.create('merchant-1', 'https://example.com/api', ['payment.completed']);

    expect(webhooksRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 'merchant-1',
      url: 'https://example.com/api',
      events: ['payment.completed'],
    }));
    expect(webhooksRepo.create.mock.calls[0][0].secret).toBeDefined();
    expect(result).toEqual(saved);
  });

  it('saves merchant webhook retry configuration', async () => {
    const merchant = { id: 'merchant-1', webhookRetryConfig: null };
    merchantsRepo.findOne.mockResolvedValue(merchant);
    const config = { maxAttempts: 3, retryDelays: [1000, 5000] };

    await expect(service.updateRetryConfig('merchant-1', config)).resolves.toEqual(config);
    expect(merchant.webhookRetryConfig).toEqual(config);
    expect(merchantsRepo.save).toHaveBeenCalledWith(merchant);
  });

  it('preserves an unset policy so the processor can use global defaults', async () => {
    merchantsRepo.findOne.mockResolvedValue({ id: 'merchant-1', webhookRetryConfig: null });
    await expect(service.getRetryConfig('merchant-1')).resolves.toBeNull();
  });

  it('uses the supplied secret when provided', async () => {
    const saved = { id: 'hook-1', secret: 'top-secret' } as any;
    webhooksRepo.save.mockResolvedValue(saved);

    await service.create('merchant-1', 'https://example.com/api', ['payment.completed'], 'top-secret');

    expect(webhooksRepo.create).toHaveBeenCalledWith(expect.objectContaining({ secret: 'top-secret' }));
  });

  it('findAll returns the merchant webhooks in order', async () => {
    const hooks = [{ id: 'hook-1' }, { id: 'hook-2' }];
    webhooksRepo.find.mockResolvedValue(hooks);

    await expect(service.findAll('merchant-1')).resolves.toEqual(hooks);
    expect(webhooksRepo.find).toHaveBeenCalledWith({ where: { merchantId: 'merchant-1' } });
  });

  it('remove throws when the webhook is not found for the merchant', async () => {
    webhooksRepo.findOne.mockResolvedValue(null);

    await expect(service.remove('hook-1', 'merchant-1')).rejects.toThrow(NotFoundException);
    expect(webhooksRepo.remove).not.toHaveBeenCalled();
  });

  it('remove deletes the matching webhook for the merchant', async () => {
    const webhook = { id: 'hook-1', merchantId: 'merchant-1' } as any;
    webhooksRepo.findOne.mockResolvedValue(webhook);

    await expect(service.remove('hook-1', 'merchant-1')).resolves.toEqual(webhook);
    expect(webhooksRepo.remove).toHaveBeenCalledWith(webhook);
  });

  it('dispatch enqueues delivery for matching events only', async () => {
    const webhooks = [
      { id: 'hook-1', merchantId: 'merchant-1', events: ['payment.completed'], isActive: true },
      { id: 'hook-2', merchantId: 'merchant-1', events: ['payment.failed'], isActive: true },
    ];
    webhooksRepo.find.mockResolvedValue(webhooks);

    await service.dispatch('merchant-1', 'payment.completed', { id: 'p-1' });

    expect(webhookDelivery.enqueueDelivery).toHaveBeenCalledTimes(1);
    expect(webhookDelivery.enqueueDelivery).toHaveBeenCalledWith(webhooks[0], 'payment.completed', expect.any(String));
  });
});
