import { DateTime, IANAZone } from 'luxon';
import { badRequest } from './errors.js';

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

export const isValidTimezone = (timezone: string): boolean => IANAZone.isValidZone(timezone);

/**
 * Times with an explicit offset are absolute. Times without one are wall-clock
 * times in the application's timezone. In a DST gap, Luxon moves the time forward.
 */
export function parseAppTime(input: string, timezone: string): Date {
  const parsed = HAS_OFFSET.test(input)
    ? DateTime.fromISO(input, { setZone: true })
    : DateTime.fromISO(input, { zone: timezone });
  if (!parsed.isValid) {
    throw badRequest('INVALID_DATETIME', `"${input}" is not a valid ISO 8601 date-time`);
  }
  return parsed.toJSDate();
}

export const formatInZone = (date: Date, timezone: string, format = "yyyy-MM-dd'T'HH:mm:ssZZ") =>
  DateTime.fromJSDate(date, { zone: timezone }).toFormat(format);

/** Converts inclusive local dates into a half-open UTC range. */
export function localDateRange(from: string, to: string, timezone: string) {
  const start = DateTime.fromISO(from, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(to, { zone: timezone }).startOf('day');
  if (!start.isValid || !end.isValid) {
    throw badRequest('INVALID_DATE_RANGE', 'from and to must be dates in YYYY-MM-DD format');
  }
  if (start > end) {
    throw badRequest('INVALID_DATE_RANGE', 'from must not be after to');
  }
  return { start: start.toJSDate(), endExclusive: end.plus({ days: 1 }).toJSDate() };
}

export const localToday = (timezone: string, now: Date): DateTime =>
  DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
