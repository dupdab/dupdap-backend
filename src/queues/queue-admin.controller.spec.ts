import { Test, TestingModule } from '@nestjs/testing';
import { QueueAdminController } from './queue-admin.controller';
import { QueueMetricsService } from './queue-metrics.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { NotFoundException } from '@nestjs/common';
import type { Queue, Job } from 'bull';

describe('QueueAdminController', () => {
  let controller: QueueAdminController;
  let settlementQ: Queue;
  let webhookQ: Queue;
  let notificationQ: Queue;
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
    webhookQ = mockQueue('webhook') as unknown as Queue;
    notificationQ = mockQueue('notification') as unknown as Queue;
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
    (controller as any).settlementQ = settlementQ;
    (controller as any).webhookQ = webhookQ;
    (controller as any).notificationQ = notificationQ;
    (controller as any).stellarMonitorQ = stellarMonitorQ;
    (controller as any).sorobanEventDlqQ = sorobanEventDlqQ;
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

    it('should return failed jobs for webhook queue', async () => {
      const result = await controller.getFailedJobs('webhook');
      expect(result).toEqual({ jobs: [], total: 0 });
      expect(webhookQ.getFailed).toHaveBeenCalled();
    });

    it('should return failed jobs for notification queue', async () => {
      const result = await controller.getFailedJobs('notification');
      expect(result).toEqual({ jobs: [], total: 0 });
      expect(notificationQ.getFailed).toHaveBeenCalled();
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

    it('should throw NotFoundException for unknown queue', async () => {
      await expect(controller.getFailedJobs('unknown-queue')).rejects.toThrow(NotFoundException);
    });

    it('should log alert when DLQ exceeds threshold', async () => {
      const jobs = Array(15).fill(mockJob);
      (sorobanEventDlqQ.getFailed as jest.Mock).mockResolvedValue(jobs);
      const loggerSpy = jest.spyOn((controller as any).logger, 'warn');

      await controller.getFailedJobs('soroban-event-dlq');

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('DLQ alert'));
    });
  });

  describe('retryFailedJob', () => {
    it('should retry failed job in settlement queue', async () => {
      const result = await controller.retryFailedJob('settlement', '123');
      expect(result.message).toContain('re-queued successfully');
      expect(settlementQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should retry failed job in webhook queue', async () => {
      const result = await controller.retryFailedJob('webhook', '123');
      expect(result.message).toContain('re-queued successfully');
      expect(webhookQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should retry failed job in notification queue', async () => {
      const result = await controller.retryFailedJob('notification', '123');
      expect(result.message).toContain('re-queued successfully');
      expect(notificationQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should retry failed job in stellar-monitor queue', async () => {
      const result = await controller.retryFailedJob('stellar-monitor', '123');
      expect(result.message).toContain('re-queued successfully');
      expect(stellarMonitorQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should retry failed job in soroban-event-dlq queue', async () => {
      const result = await controller.retryFailedJob('soroban-event-dlq', '123');
      expect(result.message).toContain('re-queued successfully');
      expect(sorobanEventDlqQ.getJob).toHaveBeenCalledWith('123');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should throw NotFoundException for unknown queue', async () => {
      await expect(controller.retryFailedJob('unknown-queue', '123')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for unknown job', async () => {
      (sorobanEventDlqQ.getJob as jest.Mock).mockResolvedValue(null);
      await expect(controller.retryFailedJob('soroban-event-dlq', '999')).rejects.toThrow(NotFoundException);
    });
  });
});
