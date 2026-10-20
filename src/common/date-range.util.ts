import { BadRequestException } from '@nestjs/common';

export type DateRangePeriod = 'daily' | 'monthly';

export interface DateRange {
  start: Date;
  endExclusive: Date;
}

export const ANALYTICS_RANGE_PRESETS = ['today', '7d', '30d', '90d', 'ytd', 'custom'] as const;
export type AnalyticsRangePreset = (typeof ANALYTICS_RANGE_PRESETS)[number];

export interface AnalyticsRangeInput {
  preset?: AnalyticsRangePreset;
  from?: string;
  to?: string;
}

const MAX_ANALYTICS_RANGE_YEARS = 1;

export function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Dates must use YYYY-MM-DD format');
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid date: ${value}`);
  }

  return parsed;
}

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function addUtcDays(value: Date, days: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days));
}

export function addUtcMonths(value: Date, months: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function addUtcYears(value: Date, years: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear() + years, value.getUTCMonth(), value.getUTCDate()));
}

function parseIsoDateTime(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`"${field}" must be an ISO 8601 date or datetime`);
  }

  return parsed;
}

/**
 * Resolves an analytics range into a half-open UTC window aligned to whole days.
 * Presets end today (inclusive). Custom `from`/`to` accept ISO 8601 dates or datetimes
 * and are inclusive by day. Returns undefined when no range is requested so callers can
 * keep their own defaults. Windows are capped at one year.
 */
export function resolveAnalyticsWindow(
  input: AnalyticsRangeInput,
  now = new Date(),
): DateRange | undefined {
  const { preset, from, to } = input;
  if (!preset && !from && !to) {
    return undefined;
  }

  if (preset && !ANALYTICS_RANGE_PRESETS.includes(preset)) {
    throw new BadRequestException(
      `"preset" must be one of: ${ANALYTICS_RANGE_PRESETS.join(', ')}`,
    );
  }

  const today = startOfUtcDay(now);
  if (preset && preset !== 'custom') {
    if (from || to) {
      throw new BadRequestException('"preset" cannot be combined with "from" or "to"');
    }

    const starts: Record<Exclude<AnalyticsRangePreset, 'custom'>, Date> = {
      today,
      '7d': addUtcDays(today, -6),
      '30d': addUtcDays(today, -29),
      '90d': addUtcDays(today, -89),
      ytd: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    };

    return { start: starts[preset], endExclusive: addUtcDays(today, 1) };
  }

  if (!from) {
    throw new BadRequestException('"from" is required for a custom range');
  }

  const start = startOfUtcDay(parseIsoDateTime(from, 'from'));
  const endExclusive = to
    ? addUtcDays(startOfUtcDay(parseIsoDateTime(to, 'to')), 1)
    : addUtcDays(today, 1);

  if (start >= endExclusive) {
    throw new BadRequestException('"from" must be before or equal to "to"');
  }

  if (endExclusive > addUtcYears(start, MAX_ANALYTICS_RANGE_YEARS)) {
    throw new BadRequestException(
      `Analytics range must not exceed ${MAX_ANALYTICS_RANGE_YEARS} year`,
    );
  }

  return { start, endExclusive };
}

/**
 * Resolves an optional YYYY-MM-DD range into a half-open UTC range.
 * Defaults to the last 30 days (daily) or last 12 months (monthly).
 */
export function resolveDateRange(
  period: DateRangePeriod,
  dateFrom?: string,
  dateTo?: string,
): DateRange {
  if (period === 'daily') {
    const endInclusive = dateTo ? parseIsoDate(dateTo) : startOfUtcDay(new Date());
    const start = dateFrom ? parseIsoDate(dateFrom) : addUtcDays(endInclusive, -29);

    if (start > endInclusive) {
      throw new BadRequestException('"dateFrom" must be before or equal to "dateTo"');
    }

    return { start, endExclusive: addUtcDays(endInclusive, 1) };
  }

  const endMonth = startOfUtcMonth(dateTo ? parseIsoDate(dateTo) : new Date());
  const startMonth = dateFrom
    ? startOfUtcMonth(parseIsoDate(dateFrom))
    : addUtcMonths(endMonth, -11);

  if (startMonth > endMonth) {
    throw new BadRequestException('"dateFrom" must be before or equal to "dateTo"');
  }

  return { start: startMonth, endExclusive: addUtcMonths(endMonth, 1) };
}
