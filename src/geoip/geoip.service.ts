import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as maxmind from 'maxmind';
import type { CountryResponse, Reader } from 'maxmind';

/**
 * Resolves a customer IP to an ISO 3166-1 alpha-2 country code using a local
 * MaxMind GeoIP2/GeoLite2 Country database (#501). Lookups are in-process and
 * never call out to a third party. When GEOIP_DB_PATH is unset, lookups return
 * null and no payment is geo-flagged.
 */
@Injectable()
export class GeoipService implements OnModuleInit {
  private readonly logger = new Logger(GeoipService.name);
  private reader: Reader<CountryResponse> | null = null;
  private readonly blockedCountries: Set<string>;

  constructor(private readonly config: ConfigService) {
    this.blockedCountries = new Set(
      (this.config.get<string>('BLOCKED_COUNTRIES') ?? '')
        .split(',')
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
    );
  }

  async onModuleInit(): Promise<void> {
    const dbPath = this.config.get<string>('GEOIP_DB_PATH');
    if (!dbPath) {
      this.logger.warn('GEOIP_DB_PATH not set; payment country lookup is disabled');
      return;
    }
    this.reader = await maxmind.open<CountryResponse>(dbPath);
  }

  lookupCountry(ip?: string): string | null {
    if (!this.reader || !ip || !maxmind.validate(ip)) return null;
    return this.reader.get(ip)?.country?.iso_code ?? null;
  }

  isBlockedCountry(countryCode: string | null): boolean {
    return countryCode !== null && this.blockedCountries.has(countryCode);
  }
}
