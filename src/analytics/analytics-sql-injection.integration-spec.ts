import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
const request = require('supertest');
import { MerchantAnalyticsController } from './merchant-analytics.controller';
import { MerchantAnalyticsService } from './merchant-analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('Analytics SQL injection rejection (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MerchantAnalyticsController],
      providers: [{ provide: MerchantAnalyticsService, useValue: { getPaymentFunnel: jest.fn() } }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => app.close());

  it('returns 400 for an SQL injection string in a date parameter', async () => {
    await request(app.getHttpServer())
      .get('/analytics/funnel?startDate=2026-01-01%27%3B%20DROP%20TABLE%20payments%3B--')
      .expect(400);
  });
});
