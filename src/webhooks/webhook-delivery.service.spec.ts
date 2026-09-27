import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import * as crypto from 'crypto';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { QueueConfigService } from '../config/queue-config.service';

describe('WebhookDeliveryService', () => {
  let service: WebhookDeliveryService;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDeliveryService,
        { provide: getQueueToken('webhook-delivery'), useValue: queue },
        { provide: QueueConfigService, useValue: {} },
      ],
    }).compile();

    service = module.get(WebhookDeliveryService);
  });

  it('builds a deterministic dedupe jobId from the webhook, event, and payload body', async () => {
    const webhook = {
      id: 'hook-1',
      merchantId: 'merchant-1',
      url: 'https://example.com/webhook',
      secret: 's3cr3t',
    } as any;
    const body = JSON.stringify({ event: 'payment.completed', data: { id: 'p-1' } });

    await service.enqueueDelivery(webhook, 'payment.completed', body);

    const expectedId = crypto
      .createHash('sha256')
      .update(`${webhook.id}:payment.completed:${body}`)
      .digest('hex');

    expect(queue.add).toHaveBeenCalledWith(
      'deliver',
      expect.objectContaining({
        webhookId: 'hook-1',
        merchantId: 'merchant-1',
        event: 'payment.completed',
        body,
      }),
      expect.objectContaining({ jobId: expectedId, removeOnComplete: true, removeOnFail: false }),
    );
  });

  it('reuses the same job id for the same logical event payload', async () => {
    const webhook = { id: 'hook-1', merchantId: 'merchant-1', url: 'https://example.com/webhook', secret: 's3cr3t' } as any;
    const body = JSON.stringify({ event: 'payment.completed', data: { id: 'p-1' } });

    await service.enqueueDelivery(webhook, 'payment.completed', body);
    await service.enqueueDelivery(webhook, 'payment.completed', body);

    const firstCall = queue.add.mock.calls[0][2];
    const secondCall = queue.add.mock.calls[1][2];

    expect(firstCall.jobId).toBe(secondCall.jobId);
  });
});
