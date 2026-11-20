import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, TypeOrmHealthIndicator, HttpHealthIndicator } from '@nestjs/terminus';
import { getQueueToken } from '@nestjs/bull';
import { HealthController } from './health.controller';
import { CacheService } from '../cache/cache.service';
import { QUEUE_NAMES } from '../queues/queue.constants';

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthCheckService: jest.Mocked<HealthCheckService>;
  let mockTypeOrmHealthIndicator: jest.Mocked<TypeOrmHealthIndicator>;
  let mockHttpHealthIndicator: jest.Mocked<HttpHealthIndicator>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockCacheService: jest.Mocked<Pick<CacheService, 'ping'>>;
  let mockWebhookQueue: {
    isReady: jest.Mock;
    client: { ping: jest.Mock };
    count: jest.Mock;
  };

  beforeEach(async () => {
    mockHealthCheckService = {
      check: jest.fn(),
    } as any;

    mockTypeOrmHealthIndicator = {
      pingCheck: jest.fn(),
    } as any;

    mockHttpHealthIndicator = {
      pingCheck: jest.fn(),
    } as any;

    mockConfigService = {
      get: jest.fn(),
    } as any;

    mockCacheService = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };

    mockWebhookQueue = {
      isReady: jest.fn().mockReturnValue(true),
      client: { ping: jest.fn().mockResolvedValue('PONG') },
      count: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: mockTypeOrmHealthIndicator },
        { provide: HttpHealthIndicator, useValue: mockHttpHealthIndicator },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: getQueueToken(QUEUE_NAMES.webhookDelivery), useValue: mockWebhookQueue },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('liveness', () => {
    it('should return ok status', () => {
      const result = controller.liveness();
      expect(result).toEqual({ status: 'ok' });
    });
  });

  describe('adminHealth', () => {
    it('should return healthy status when all components are ok', async () => {
      mockTypeOrmHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        if (key === 'QUEUE_DEPTH_THRESHOLD') return 1000;
        return defaultValue;
      });

      const result = await controller.adminHealth();

      expect(result.status).toBe('healthy');
      expect(result.components).toBeDefined();
      expect(result.components.database.status).toBe('ok');
      expect(result.components.stellar.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(result.responseTime).toBeDefined();
    });

    it('should return degraded status when non-critical components fail', async () => {
      mockTypeOrmHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      mockHttpHealthIndicator.pingCheck
        .mockResolvedValueOnce({ stellar: { status: 'up' } })
        .mockRejectedValueOnce(new Error('Partner API down'));

      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        if (key === 'PARTNER_API_URL') return 'https://partner-api.example.com';
        if (key === 'QUEUE_DEPTH_THRESHOLD') return 1000;
        return defaultValue;
      });

      const result = await controller.adminHealth();

      expect(result.status).toBe('degraded');
      expect(result.components.database.status).toBe('ok');
      expect(result.components.stellar.status).toBe('ok');
      expect(result.components.partnerApi.status).toBe('degraded');
    });

    it('should ping Redis via CacheService and report ok', async () => {
      mockTypeOrmHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        if (key === 'QUEUE_DEPTH_THRESHOLD') return 1000;
        return defaultValue;
      });

      await controller.adminHealth();

      expect(mockCacheService.ping).toHaveBeenCalled();
    });

    it('should report Redis as degraded when the ping fails', async () => {
      mockTypeOrmHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
      mockCacheService.ping.mockRejectedValue(new Error('Redis unavailable'));
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        if (key === 'QUEUE_DEPTH_THRESHOLD') return 1000;
        return defaultValue;
      });

      const result = await controller.adminHealth();

      expect(result.components.redis.status).toBe('degraded');
      expect(result.components.redis.latency).toBeGreaterThanOrEqual(0);
    });

    it('should throw 503 when critical components are down', async () => {
      mockTypeOrmHealthIndicator.pingCheck.mockRejectedValue(new Error('Database down'));
      mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        if (key === 'QUEUE_DEPTH_THRESHOLD') return 1000;
        return defaultValue;
      });

      await expect(controller.adminHealth()).rejects.toThrow();
    });

    describe('queue health check', () => {
      beforeEach(() => {
        mockTypeOrmHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
        mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
        mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
          if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
          if (key === 'QUEUE_DEPTH_THRESHOLD') return 100;
          return defaultValue;
        });
      });

      it('reports ok when Redis ping succeeds and queue depth is below threshold', async () => {
        mockWebhookQueue.count.mockResolvedValue(10);

        const result = await controller.adminHealth();

        expect(result.components.queue.status).toBe('ok');
        expect(mockWebhookQueue.client.ping).toHaveBeenCalled();
      });

      it('reports degraded when queue depth exceeds the configured threshold', async () => {
        mockWebhookQueue.count.mockResolvedValue(500);

        const result = await controller.adminHealth();

        expect(result.components.queue.status).toBe('degraded');
        expect((result.components.queue as any).depth).toBe(500);
      });

      it('reports down when the queue client ping fails', async () => {
        mockWebhookQueue.client.ping.mockRejectedValue(new Error('Redis connection lost'));

        const result = await controller.adminHealth();

        expect(result.components.queue.status).toBe('down');
      });

      it('reports down when the queue is not ready', async () => {
        mockWebhookQueue.isReady.mockReturnValue(false);

        const result = await controller.adminHealth();

        expect(result.components.queue.status).toBe('down');
      });
    });
  });

  describe('readiness', () => {
    it('returns ready when database, Redis, and Stellar all respond', async () => {
      mockTypeOrmHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        return defaultValue;
      });

      const result = await controller.ready();

      expect(result).toEqual({ status: 'ready' });
    });

    it('throws 503 when the database is unreachable', async () => {
      mockTypeOrmHealthIndicator.pingCheck.mockRejectedValue(new Error('DB down'));
      mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        return defaultValue;
      });

      await expect(controller.ready()).rejects.toThrow();
    });
  });
});
