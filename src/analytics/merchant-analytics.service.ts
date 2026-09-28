import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { Payment } from '../payments/entities/payment.entity';
import { Merchant } from '../merchants/entities/merchant.entity';

const DAILY_SIGNUP_WINDOW_DAYS = 30;
const ACTIVATION_WINDOW_DAYS = 7;

interface SignupRow {
  day: string;
  count: string;
}

interface CountRow {
  count: string;
}

export interface MerchantAnalyticsPoint {
  date: string;
  signups: number;
}

export interface MerchantAnalyticsResponse {
  generatedAt: string;
  dailySignups: MerchantAnalyticsPoint[];
  activationRate: {
    windowDays: number;
    activatedMerchants: number;
    totalMerchants: number;
    percentage: number;
  };
  monthlyActiveMerchants: {
    month: string;
    count: number;
  };
}

export interface TopMerchant {
  businessName: string;
  volume: number;
  paymentCount: number;
  settlementCount: number;
  country: string;
}

export interface TopMerchantsResponse {
  merchants: TopMerchant[];
  period: string;
  generatedAt: string;
}

export interface FunnelStage {
  stage: string;
  count: number;
  percentage: number;
  dropOffCount?: number;
  dropOffPercentage?: number;
}

export interface PaymentFunnelResponse {
  stages: FunnelStage[];
  totalCreated: number;
  period: {
    startDate: string;
    endDate: string;
  };
  network?: string;
  generatedAt: string;
}

@Injectable()
export class MerchantAnalyticsService {
  private readonly logger = new Logger(MerchantAnalyticsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Payment) private readonly paymentsRepo: Repository<Payment>,
    @InjectRepository(Merchant) private readonly merchantsRepo: Repository<Merchant>,
    private readonly cache: CacheService,
  ) {}

  private analyticsCacheKey(params: {
    merchantId: string;
    endpoint: string;
    dateRange: string;
  }): string {
    return `analytics:${params.merchantId}:${params.endpoint}:${params.dateRange}`;
  }

  async getMetrics(asOf = new Date()): Promise<MerchantAnalyticsResponse> {
    const cacheKey = this.analyticsCacheKey({
      merchantId: 'admin',
      endpoint: 'merchants',
      dateRange: asOf.toISOString().slice(0, 10),
    });

    const { value } = await this.cache.getOrSet(
      cacheKey,
      async () => {
        const [dailySignupsRows, activationRows, monthlyActiveRows] =
          await Promise.all([
            this.dataSource.query<SignupRow[]>(
              `SELECT DATE_TRUNC('day', "createdAt")::date::text AS day, COUNT(*)::text AS count
               FROM merchants
               WHERE "createdAt" >= ($1::timestamptz - ($2 * INTERVAL '1 day'))
               GROUP BY 1 ORDER BY 1 ASC`,
              [asOf.toISOString(), DAILY_SIGNUP_WINDOW_DAYS - 1],
            ),
            this.dataSource.query<CountRow[]>(
              `SELECT COUNT(*) FILTER (WHERE status = 'active')::text AS count,
                      COUNT(*)::text AS total
               FROM merchants`,
            ),
            this.dataSource.query<CountRow[]>(
              `SELECT COUNT(*)::text AS count
               FROM merchants
               WHERE status = 'active'
                 AND DATE_TRUNC('month', "updatedAt") = DATE_TRUNC('month', $1::timestamptz)`,
              [asOf.toISOString()],
            ),
          ]);

        const activation = activationRows[0] as CountRow & { total: string };
        const activatedMerchants = Number(activation?.count ?? 0);
        const totalMerchants = Number(activation?.total ?? 0);

        return {
          generatedAt: asOf.toISOString(),
          dailySignups: this.buildDailySignupSeries(asOf, dailySignupsRows),
          activationRate: {
            windowDays: ACTIVATION_WINDOW_DAYS,
            activatedMerchants,
            totalMerchants,
            percentage:
              totalMerchants === 0
                ? 0
                : Number(((activatedMerchants / totalMerchants) * 100).toFixed(2)),
          },
          monthlyActiveMerchants: {
            month: asOf.toISOString().slice(0, 7),
            count: Number(monthlyActiveRows[0]?.count ?? 0),
          },
        } satisfies MerchantAnalyticsResponse;
      },
      { ttlSeconds: 10 * 60 },
    );

    return value;
  }

  private buildDailySignupSeries(
    asOf: Date,
    rows: SignupRow[],
  ): MerchantAnalyticsPoint[] {
    const counts = new Map(rows.map((row) => [row.day, Number(row.count)]));
    const series: MerchantAnalyticsPoint[] = [];

    for (let offset = DAILY_SIGNUP_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
      const current = new Date(asOf);
      current.setUTCDate(current.getUTCDate() - offset);
      const date = current.toISOString().slice(0, 10);
      series.push({
        date,
        signups: counts.get(date) ?? 0,
      });
    }

    return series;
  }

  async getTopMerchants(limit: number = 10, period: string = '30d'): Promise<TopMerchantsResponse> {
    const cacheKey = this.analyticsCacheKey({
      merchantId: 'admin',
      endpoint: 'top-merchants',
      dateRange: `${limit}:${period}`,
    });

    const periodDays = this.getPeriodDays(period);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - periodDays);

    try {
      const { value, cacheHit } = await this.cache.getOrSet(
        cacheKey,
        async () => {
          const merchants = await this.dataSource.query(
            `SELECT m."businessName",
               COALESCE(SUM(p."amountUsd"), 0)::decimal AS volume,
               COUNT(p.id)::int AS "paymentCount",
               COUNT(DISTINCT p."settlementId") FILTER (WHERE p."settlementId" IS NOT NULL)::int AS "settlementCount",
               m.country
             FROM merchants m
             LEFT JOIN payments p ON m.id = p."merchantId"
               AND p."createdAt" >= $1
               AND p.status IN ('confirmed', 'settling', 'settled')
             WHERE m.status = 'active'
             GROUP BY m.id, m."businessName", m.country
             ORDER BY volume DESC, "paymentCount" DESC
             LIMIT $2`,
            [cutoffDate.toISOString(), limit],
          );

          const response: TopMerchantsResponse = {
            merchants: merchants.map((row: any) => ({
              businessName: row.businessName,
              volume: parseFloat(row.volume),
              paymentCount: row.paymentCount,
              settlementCount: row.settlementCount,
              country: row.country || 'Unknown',
            })),
            period,
            generatedAt: new Date().toISOString(),
          };

          this.logger.debug(`Generated top merchants for ${limit}-${period}: ${merchants.length} results`);
          return response;
        },
        { ttlSeconds: 10 * 60 },
      );

      this.logger.debug(`Returning ${cacheHit ? 'cached' : 'fresh'} top merchants for ${limit}-${period}`);
      return value;
    } catch (error) {
      this.logger.error(`Failed to get top merchants: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getPaymentFunnel(
    startDate?: string,
    endDate?: string,
    network?: string,
  ): Promise<PaymentFunnelResponse> {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new

/* … truncated 3352 chars — edit only what you need near the top … */
