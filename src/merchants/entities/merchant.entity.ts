import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from 'typeorm';
import { Exclude, Transform } from 'class-transformer';
import { Payment } from '../../payments/entities/payment.entity';
import { Settlement } from '../../settlements/entities/settlement.entity';
import { Webhook } from '../../webhooks/entities/webhook.entity';
import { encryptedColumnTransformer } from '../../security/encrypted-column.transformer';
import { numericColumnTransformer } from '../../database/numeric-column.transformer';
import { ApiScope } from '../../auth/scopes';

export enum MerchantStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  PENDING = 'pending',
}

export enum MerchantRole {
  ADMIN = 'admin',
  MERCHANT = 'merchant',
  SUPERADMIN = 'superadmin',
}

export enum SettlementFrequency {
  INSTANT = 'INSTANT',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
}

export enum KycStatus { UNVERIFIED = 'UNVERIFIED', PENDING = 'PENDING', VERIFIED = 'VERIFIED', REJECTED = 'REJECTED' }

/**
 * Maps a merchant's country to the fiat currency used for its settlements.
 * Covers the fiat currencies supported by Stellar anchors (SEP-24/SEP-31
 * off-ramps). Falls back to USD for unknown/missing countries so settlements
 * are never silently denominated in an unrelated currency.
 */
export const COUNTRY_SETTLEMENT_CURRENCY: Record<string, string> = {
  // Africa
  NG: 'NGN',
  GH: 'GHS',
  KE: 'KES',
  ZA: 'ZAR',
  TZ: 'TZS',
  UG: 'UGX',
  RW: 'RWF',
  ZM: 'ZMW',
  MW: 'MWK',
  MZ: 'MZN',
  BW: 'BWP',
  NA: 'NAD',
  LS: 'LSL',
  SZ: 'SZL',
  ET: 'ETB',
  EG: 'EGP',
  MA: 'MAD',
  TN: 'TND',
  DZ: 'DZD',
  SN: 'XOF',
  CI: 'XOF',
  ML: 'XOF',
  BF: 'XOF',
  BJ: 'XOF',
  TG: 'XOF',
  NE: 'XOF',
  GW: 'XOF',
  CM: 'XAF',
  GA: 'XAF',
  CG: 'XAF',
  TD: 'XAF',
  CF: 'XAF',
  GQ: 'XAF',
  CD: 'CDF',
  AO: 'AOA',
  // Americas
  US: 'USD',
  CA: 'CAD',
  MX: 'MXN',
  BR: 'BRL',
  AR: 'ARS',
  CL: 'CLP',
  CO: 'COP',
  PE: 'PEN',
  UY: 'UYU',
  PY: 'PYG',
  BO: 'BOB',
  EC: 'USD',
  PA: 'USD',
  SV: 'USD',
  GT: 'GTQ',
  CR: 'CRC',
  DO: 'DOP',
  JM: 'JMD',
  TT: 'TTD',
  HT: 'HTG',
  // Europe
  GB: 'GBP',
  IE: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  PT: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  LU: 'EUR',
  SK: 'EUR',
  SI: 'EUR',
  EE: 'EUR',
  LV: 'EUR',
  LT: 'EUR',
  CY: 'EUR',
  MT: 'EUR',
  HR: 'EUR',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  BG: 'BGN',
  TR: 'TRY',
  UA: 'UAH',
  RS: 'RSD',
  IS: 'ISK',
  // Middle East & Asia
  AE: 'AED',
  SA: 'SAR',
  QA: 'QAR',
  KW: 'KWD',
  BH: 'BHD',
  OM: 'OMR',
  JO: 'JOD',
  IL: 'ILS',
  LB: 'LBP',
  IQ: 'IQD',
  IR: 'IRR',
  PK: 'PKR',
  IN: 'INR',
  BD: 'BDT',
  LK: 'LKR',
  NP: 'NPR',
  PH: 'PHP',
  ID: 'IDR',
  MY: 'MYR',
  SG: 'SGD',
  TH: 'THB',
  VN: 'VND',
  CN: 'CNY',
  HK: 'HKD',
  TW: 'TWD',
  JP: 'JPY',
  KR: 'KRW',
  KZ: 'KZT',
  UZ: 'UZS',
  GE: 'GEL',
  AM: 'AMD',
  AZ: 'AZN',
  // Oceania
  AU: 'AUD',
  NZ: 'NZD',
  FJ: 'FJD',
  PG: 'PGK',
};

/** Currency used when a country has no explicit settlement currency mapping. */
export const DEFAULT_SETTLEMENT_CURRENCY = 'USD';

/**
 * Resolves the settlement currency for a country code, optionally using an
 * admin-configured mapping (RuntimeConfig `settlements.country_currency_map`).
 * Returns `undefined` when the country is unknown and no default is allowed.
 */
export function resolveSettlementCurrency(
  country: string | null | undefined,
  overrides?: Record<string, string> | null,
): string | undefined {
  if (!country) return undefined;
  const code = country.trim().toUpperCase();
  const override = overrides?.[code];
  if (override) return override.toUpperCase();
  return COUNTRY_SETTLEMENT_CURRENCY[code];
}

export function settlementCurrencyForCountry(
  country?: string | null,
  overrides?: Record<string, string> | null,
): string {
  return resolveSettlementCurrency(country, overrides) ?? DEFAULT_SETTLEMENT_CURRENCY;
}

@Entity('merchants')
export class Merchant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Exclude()
  @Column()
  passwordHash: string;

  @Column()
  businessName: string;

  @Column({ nullable: true })
  businessType: string;

  @Column({ nullable: true })
  country: string;

  /**
   * Fiat currency this merchant's settlements are denominated in.
   * Derived from `country` when not explicitly set.
   */
  get settlementCurrency(): string {
    return settlementCurrencyForCountry(this.country);
  }

  @Transform(({ value }) => (value ? `****${String(value).slice(-4)}` : null))
  @Column({
    nullable: true,
    transformer: encryptedColumnTransformer('merchants.bankAccountNumber'),
  })
  bankAccountNumber: string;

  @Column({ nullable: true })
  bankCode: string;

  @Column({ nullable: true })
  bankName: string;

  @Column({
    type: 'enum',
    enum: MerchantStatus,
    default: MerchantStatus.PENDING,
  })
  status: MerchantStatus;

  @Column({ type: 'enum', enum: KycStatus, enumName: 'merchants_kyc_status_enum', default: KycStatus.UNVERIFIED })
  kycStatus: KycStatus;

  @Column({ type: 'jsonb', nullable: true })
  kycDocuments: Array<{ name: string; mimeType: string; data: string }> | null;

  @Column({ type: 'boolean', default: false })
  suspended: boolean;

  @Column({ type: 'text', nullable: true })
  suspendedReason: string | null;

  @Column({ type: 'enum', enum: MerchantRole, default: MerchantRole.MERCHANT })
  role: MerchantRole;

  @Column({ nullable: true })
  apiKey: string | null;

  @Exclude()
  @Column({ name: 'api_key_last_four', nullable: true, length: 4 })
  apiKeyLastFour: string | null;

  @Column('simple-array', { name: 'api_key_scopes', nullable: true })
  apiKeyScopes?: ApiScope[];

  /** CIDR ranges (or bare IPs) allowed to use the API key. Null or empty means any IP. */
  @Column('simple-array', { name: 'api_key_ip_allowlist', nullable: true })
  apiKeyIpAllowlist?: string[] | null;

  @Exclude()
  @Column({ nullable: true })
  apiKeyHash: string | null;

  @Exclude()
  @Column({ name: 'api_key_lookup_hash', nullable: true, unique: true })
  apiKeyLookupHash?: string | null;

  /** UTC timestamp at which this API key expires. Null means the key never expires. */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  apiKeyExpiresAt: Date | null;

  /** Set to the timestamp when the 14-day expiry-reminder email was sent. Null means not yet sent. */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  apiKeyExpirySentAt: Date | null;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericColumnTransformer,
  })
  totalVolumeUsd: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0.015,
    transformer: numericColumnTransformer,
  })
  feeRate: string;

  /** Per-merchant custom fee rate override. Null means use global default. */
  @Column({
    name: 'custom_fee_rate',
    type: 'numeric',
    precision: 7,
    scale: 6,
    nullable: true,
    default: null,
  })
  customFeeRate: string | null;

  /**
   * Per-merchant payment retry policy (#551). Bull jobs honour these values
   * when retrying failed payment-related work.
   * Defaults: 3 attempts, 5 minute (300,000 ms) delay.
   */
  @Column({ name: 'payment_retry_max_attempts', type: 'int', default: 3 })
  paymentRetryMaxAttempts: number;

  @Column({ name: 'payment_retry_delay_ms', type: 'int', default: 300000 })
  paymentRetryDelayMs: number;

  /** Merchant-specific webhook delivery retry policy; null uses global defaults. */
  @Column({ name: 'webhook_retry_config', type: 'jsonb', nullable: true, default: null })
  webhookRetryConfig: { maxAttempts: number; retryDelays: number[] } | null;

  @Column({ default: false })
  sandboxMode: boolean;

  /** True once the merchant has confirmed ownership of `email` (#844). Unverified merchants are restricted to sandbox mode (#888). */
  @Column({ name: 'email_verified', default: false })
  emailVerified: boolean;

  /** SHA-256 hash of the outstanding email-verification token; null when none is pending. */
  @Exclude()
  @Column({ name: 'email_verification_token_hash', type: 'text', nullable: true, default: null })
  emailVerificationTokenHash: string | null;

  /** Expiry of the outstanding email-verification token (24h after issue). */
  @Column({ name: 'email_verification_expires_at', type: 'timestamptz', nullable: true, default: null })
  emailVerificationExpiresAt: Date | null;

  @Exclude()
  @Column({ nullable: true })
  totpSecret: string | null;

  @Column({ default: false })
  totpEnabled: boolean;

  @Column({ nullable: true, type: 'text' })
  allowedIps: string | null;

  @Column({ default: true })
  paymentConfirmedEmailEnabled: boolean;

  @Column({
    type: 'enum',
    enum: SettlementFrequency,
    default: SettlementFrequency.INSTANT,
  })
  settlementFrequency: SettlementFrequency;

  @OneToMany(() => Payment, (payment) => payment.merchant)
  payments: Payment[];

  @OneToMany(() => Settlement, (settlement) => settlement.merchant)
  settlements: Settlement[];

  @OneToMany(() => Webhook, (webhook) => webhook.merchant)
  webhooks: Webhook[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
