import { describe, expect, it } from 'vitest';
import { formatInZone, isValidTimezone, localDateRange, parseAppTime } from '../../src/lib/time.js';

describe('parseAppTime', () => {
  it('reads a time without an offset in the application timezone', () => {
    expect(parseAppTime('2026-06-01T09:00', 'Asia/Shanghai').toISOString()).toBe(
      '2026-06-01T01:00:00.000Z',
    );
    expect(parseAppTime('2026-06-01T09:00', 'America/New_York').toISOString()).toBe(
      '2026-06-01T13:00:00.000Z',
    );
  });

  it('honours an explicit offset regardless of the application timezone', () => {
    expect(parseAppTime('2026-06-01T09:00:00Z', 'Asia/Shanghai').toISOString()).toBe(
      '2026-06-01T09:00:00.000Z',
    );
    expect(parseAppTime('2026-06-01T09:00:00+02:00', 'Asia/Shanghai').toISOString()).toBe(
      '2026-06-01T07:00:00.000Z',
    );
  });

  it('applies daylight saving time for the date in question', () => {
    expect(parseAppTime('2026-01-15T09:00', 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('rejects invalid values', () => {
    expect(() => parseAppTime('not-a-date', 'UTC')).toThrow(/valid ISO 8601/);
  });
});

describe('localDateRange', () => {
  it('covers whole local days as a half-open UTC range', () => {
    const { start, endExclusive } = localDateRange('2026-01-01', '2026-01-02', 'Asia/Shanghai');
    expect(start.toISOString()).toBe('2025-12-31T16:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-01-02T16:00:00.000Z');
  });

  it('rejects a reversed range', () => {
    expect(() => localDateRange('2026-02-01', '2026-01-01', 'UTC')).toThrow(/after/);
  });
});

describe('timezone helpers', () => {
  it('validates IANA names', () => {
    expect(isValidTimezone('Asia/Shanghai')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });

  it('formats in a zone', () => {
    expect(formatInZone(new Date('2026-01-01T00:00:00Z'), 'Asia/Shanghai', 'yyyy-MM-dd HH:mm')).toBe(
      '2026-01-01 08:00',
    );
  });
});
