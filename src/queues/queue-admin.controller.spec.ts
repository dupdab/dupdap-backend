import { Test, TestingModule } from '@nestjs/testing';
import { QueueAdminController } from './queue-admin.controller';
import { QueueMetricsService } from './queue-metrics.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import type { Queue, Job } from 'bull';

describe('QueueAdminController', () => {
  let controller: QueueAdminController;
  let settlementQ: Queue;
  let webhookDeliveryQ: Queue;
  let emailDeliveryQ: Queue;
  let stellarMonitorQ: Queue;
  let sorobanEventDlqQ: Queue;

  const mockJob = {
    id: '123',
    name: 'test-job',
    data: { test: 'data' },
    failedReason: 'Test failure',
    attemptsMade: 2,
    retry: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job;

  const mockQueue = (queueName: string) => ({
    getFailed: jest.fn().mockResolvedValue([]),
    getJob: jest.fn().mockResolvedValue(mockJob),
  });

  beforeEach(async () => {
    settlementQ = mockQueue('settlement') as unknown as Queue;
    webhookDeliveryQ = mockQueue('webhook-delivery') as unknown as Queue;
    emailDeliveryQ = mockQueue('email-delivery') as unknown as Queue;
    stellarMonitorQ = mockQueue('stellar-monitor') as unknown as Queue;
    sorobanEventDlqQ = mockQueue('soroban-event-dlq') as unknown as Queue;

    const mockMetricsService = {
      getMetrics: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QueueAdminController],
      providers: [
        {
          provide: QueueMetricsService,
          useValue: mockMetricsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    // Manually inject queues since we're using mocks
    controller = module.get<QueueAdminController>(QueueAdminController);
    (controller as any).settlementQueue = settlementQ;
    (controller as any).webhookDeliveryQueue = webhookDeliveryQ;
    (controller as any).emailDeliveryQueue = emailDeliveryQ;
    (controller as any).stellarMonitorQueue = stellarMonitorQ;
    (controller as any).sorobanEventDlqQueue = sorobanEventDlqQ;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFailedJobs', () => {
    it('should return failed jobs for settlement queue', async () => {
      const result = await controller.getFailedJobs('settlement');
      expect(result).toEqual({ jobs: [], total: 0 });
      expect(settlementQ.getFailed).toHaveBeenCalled();
    });

    it('should return failed jobs for webhook-delivery queue', async () => {
      const result = await controller.getFailedJobs('webhook-delivery');
      expect(result).toEqual({ jobs: [], total: 0 });
      expect(webhookDeliveryQ.getFailed).toHaveBeenCalled();
    });

    it('should return failed jobs for email-delivery queue', async () => {
      const result = await controller.getFailedJobs('email-delivery');
      expect(result).toEqual({ jobs: [], total: 0 });
      expect(emailDeliveryQ.getFailed).toHaveBeenCalled();
    });

    it('should return failed jobs for stellar-monitor queue', async () => {
      const result = await controller.getFailedJobs('stellar-monitor');
      expect(result).toEqual({ jobs: [], total: 0 });
      expect(stellarMonitorQ.getFailed).toHaveBeenCalled();
    });

    it('should return failed jobs for soroban-event-dlq queue', async () => {
      const result = await controller.getFailedJobs('soroban-event-dlq');
      expect(result).toEqual({ jobs: [], total: 0 });
      expect(sorobanEventDlqQ.getFailed).toHaveBeenCalled();
    });

    it('should throw for unknown queue', async () => {
      await expect(controller.getFailedJobs('unknown-queue')).rejects.toThrow(/Unknown queue/);
    });
  });

  describe('retryFailedJob', () => {
    it('should retry failed job in settlement queue', async () => {
      const result = await controller.retryFailedJob('settlement', '123');
      expect(result).toEqual({ success: true });
      expect(settlementQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should retry failed job in webhook-delivery queue', async () => {
      const result = await controller.retryFailedJob('webhook-delivery', '123');
      expect(result).toEqual({ success: true });
      expect(webhookDeliveryQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should retry failed job in email-delivery queue', async () => {
      const result = await controller.retryFailedJob('email-delivery', '123');
      expect(result).toEqual({ success: true });
      expect(emailDeliveryQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should retry failed job in stellar-monitor queue', async () => {
      const result = await controller.retryFailedJob('stellar-monitor', '123');
      expect(result).toEqual({ success: true });
      expect(stellarMonitorQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should retry failed job in soroban-event-dlq queue', async () => {
      const result = await controller.retryFailedJob('soroban-event-dlq', '123');
      expect(result).toEqual({ success: true });
      expect(sorobanEventDlqQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should throw for unknown queue', async () => {
      await expect(controller.retryFailedJob('unknown-queue', '123')).rejects.toThrow(/Unknown queue/);
    });

    it('should return failure for unknown job', async () => {
      (sorobanEventDlqQ.getJob as jest.Mock).mockResolvedValue(null);
      const result = await controller.retryFailedJob('soroban-event-dlq', '999');
      expect(result).toEqual({ success: false, message: 'Job not found' });
    });
  });
});
