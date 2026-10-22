/**
 * Minimal cron expression helpers used by the admin cron endpoints (#446).
 *
 * Supports the standard 5-field syntax (minute hour day-of-month month
 * day-of-week) and the 6-field syntax used by NestJS schedule where the first
 * field is seconds. Supported field syntax: wildcard, single value, range,
 * step (star-slash-n and a-b-slash-n) and comma separated lists.
 */

interface ParsedField {
  values: Set<number>;
  /** True when the field was the unrestricted `*` wildcard. */
  wildcard: boolean;
}

interface CronSchedule {
  seconds: ParsedField | null;
  minutes: ParsedField;
  hours: ParsedField;
  daysOfMonth: ParsedField;
  months: ParsedField;
  daysOfWeek: ParsedField;
}

function parseField(field: string, min: number, max: number): ParsedField {
  const values = new Set<number>();
  const wildcard = field === '*';

  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [rangePart, stepPart] = trimmed.split('/');
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid cron step "${trimmed}"`);
    }

    let start = min;
    let end = max;
    if (rangePart !== '*') {
      const [fromRaw, toRaw] = rangePart.split('-');
      const from = Number.parseInt(fromRaw, 10);
      const to = toRaw === undefined ? from : Number.parseInt(toRaw, 10);
      if (!Number.isInteger(from) || !Number.isInteger(to)) {
        throw new Error(`Invalid cron range "${trimmed}"`);
      }
      start = from;
      end = to;
    }

    for (let value = start; value <= end; value += step) {
      if (value >= min && value <= max) {
        values.add(value);
      }
    }
  }

  return { values, wildcard };
}

export function parseCronExpression(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    throw new Error(`Unsupported cron expression: "${expression}"`);
  }

  const offset = fields.length === 6 ? 1 : 0;
  const daysOfWeek = parseField(fields[fields.length - 1], 0, 7);
  // Both 0 and 7 mean Sunday.
  if (daysOfWeek.values.has(7)) {
    daysOfWeek.values.add(0);
    daysOfWeek.values.delete(7);
  }

  return {
    seconds: offset === 1 ? parseField(fields[0], 0, 59) : null,
    minutes: parseField(fields[offset], 0, 59),
    hours: parseField(fields[offset + 1], 0, 23),
    daysOfMonth: parseField(fields[offset + 2], 1, 31),
    months: parseField(fields[offset + 3], 1, 12),
    daysOfWeek,
  };
}

/**
 * Returns the next date/time at which the expression fires, or `null` when the
 * expression never fires within the search window.
 */
export function getNextCronRun(
  expression: string,
  from: Date = new Date(),
): Date | null {
  let schedule: CronSchedule;
  try {
    schedule = parseCronExpression(expression);
  } catch {
    return null;
  }

  const candidate = new Date(from.getTime());
  candidate.setMilliseconds(0);
  if (schedule.seconds) {
    candidate.setSeconds(candidate.getSeconds() + 1);
  } else {
    candidate.setMinutes(candidate.getMinutes() + 1, 0);
  }

  // Four years of minutes is enough to cover any valid expression.
  const maxIterations = 4 * 366 * 24 * 60;

  for (let i = 0; i < maxIterations; i++) {
    if (!schedule.months.values.has(candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    if (!matchesDay(candidate, schedule)) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    if (!schedule.hours.values.has(candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!schedule.minutes.values.has(candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
      continue;
    }

    if (schedule.seconds && !schedule.seconds.values.has(candidate.getSeconds())) {
      candidate.setSeconds(candidate.getSeconds() + 1, 0);
      continue;
    }

    return candidate;
  }

  return null;
}

/**
 * Cron day matching: when both day-of-month and day-of-week are restricted a
 * day matches if *either* of them matches, otherwise the restricted field
 * decides.
 */
function matchesDay(date: Date, schedule: CronSchedule): boolean {
  const domMatches = schedule.daysOfMonth.values.has(date.getDate());
  const dowMatches = schedule.daysOfWeek.values.has(date.getDay());

  const domRestricted = !schedule.daysOfMonth.wildcard;
  const dowRestricted = !schedule.daysOfWeek.wildcard;

  if (domRestricted && dowRestricted) {
    return domMatches || dowMatches;
  }
  if (domRestricted) return domMatches;
  if (dowRestricted) return dowMatches;
  return true;
}
