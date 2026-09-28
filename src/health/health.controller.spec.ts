import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, TypeOrmHealthIndicator, HttpHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { CacheService } from '../cache/cache.service';

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthCheckService: jest.Mocked<HealthCheckService>;
  let mockTypeOrmHealthIndicator: jest.Mocked<TypeOrmHealthIndicator>;
  let mockHttpHealthIndicator: jest.Mocked<HttpHealthIndicator>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockCacheService: jest.Mocked<Pick<CacheService, 'ping'>>;

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: mockTypeOrmHealthIndicator },
        { provide: HttpHealthIndicator, useValue: mockHttpHealthIndicator },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CacheService, useValue: mockCacheService },
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
      // Mock successful health checks
      mockTypeOrmHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
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
      // Mock database success but partner API failure
      mockTypeOrmHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      mockHttpHealthIndicator.pingCheck
        .mockResolvedValueOnce({ stellar: { status: 'up' } })
        .mockRejectedValueOnce(new Error('Partner API down'));
      
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        if (key === 'PARTNER_API_URL') return 'https://partner-api.example.com';
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
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string | number) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        return defaultValue;
      });

      await controller.adminHealth();

      expect(mockCacheService.ping).toHaveBeenCalled();
    });

    it('should report Redis as degraded when the ping fails', async () => {
      mockTypeOrmHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
      mockCacheService.ping.mockRejectedValue(new Error('Redis unavailable'));
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string | number) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        return defaultValue;
      });

      const result = await controller.adminHealth();

      expect(result.components.redis.status).toBe('degraded');
      expect(result.components.redis.latency).toBeGreaterThanOrEqual(0);
    });

    it('should throw 503 when critical components are down', async () => {
      // Mock database failure
      mockTypeOrmHealthIndicator.pingCheck.mockRejectedValue(new Error('Database down'));
      mockHttpHealthIndicator.pingCheck.mockResolvedValue({ stellar: { status: 'up' } });
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        return defaultValue;
      });

      await expect(controller.adminHealth()).rejects.toThrow();
    });
  });

  describe('readiness', () => {
    it('should call health check service with database and stellar checks', () => {
      mockConfigService.get.mockReturnValue('https://horizon-testnet.stellar.org');
      mockHealthCheckService.check.mockResolvedValue({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });

      controller.readiness();

      expect(mockHealthCheckService.check).toHaveBeenCalledWith([
        expect.any(Function),
        expect.any(Function),
      ]);
    });
  });
});