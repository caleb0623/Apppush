import { describe, expect, it } from 'vitest';
import {
  channelLabel,
  eventLabel,
  formatDateTime,
  formatRate,
  reachesRealDevice,
  relativeSeconds,
  splitList,
} from '@/lib/format';

describe('delivery labels', () => {
  it('says who vouches for each stage', () => {
    const event = (type: string, source: string, inferred = false) => ({ type, source, inferred });
    expect(eventLabel(event('SENT', 'PROVIDER'))).toBe('Accepted by provider (provider response)');
    expect(eventLabel(event('DISPLAYED', 'DEVICE_CLIENT'))).toBe('Displayed (reported by the device)');
    expect(eventLabel(event('DELIVERED', 'DEVICE_CLIENT', true))).toBe(
      'Received by device (reported by the device, inferred)',
    );
    expect(eventLabel(event('DELIVERED', 'DELIVERY_SIMULATOR'))).toBe('Received by device (simulator)');
  });

  it('knows which plans can reach a real phone', () => {
    expect(reachesRealDevice('fcm_mtpush', '')).toBe(true);
    expect(reachesRealDevice('mtpush_fcm', '')).toBe(true);
    expect(reachesRealDevice('mtpush', '')).toBe(false);
    expect(reachesRealDevice('pns_mtpush', '')).toBe(false);
    expect(reachesRealDevice('mtpush', 'fcm')).toBe(true);
    expect(reachesRealDevice('fcm_mtpush', 'xiaomi')).toBe(false);
  });
});

describe('format helpers', () => {
  it('shows a dash, not 0%, when a rate has no denominator', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(undefined)).toBe('—');
    expect(formatRate(0)).toBe('0.0%');
    expect(formatRate(0.8567)).toBe('85.7%');
  });

  it('formats times in the application timezone', () => {
    expect(formatDateTime('2026-01-01T00:00:00Z', 'Asia/Shanghai')).toContain('08:00');
    expect(formatDateTime('2026-01-01T00:00:00Z', 'America/New_York')).toContain('19:00');
    expect(formatDateTime(null)).toBe('—');
  });

  it('splits lists on commas and whitespace, dropping blanks and duplicates', () => {
    expect(splitList('a, b\nc,,a  ')).toEqual(['a', 'b', 'c']);
    expect(splitList('   ')).toEqual([]);
  });

  it('labels channels, including the unresolved manufacturer slot', () => {
    expect(channelLabel('mtpush')).toBe('EngageLab');
    expect(channelLabel('pns')).toBe('Manufacturer');
    expect(channelLabel(null)).toBe('—');
  });

  it('describes how long ago something happened', () => {
    const now = Date.parse('2026-01-01T00:02:00Z');
    expect(relativeSeconds('2026-01-01T00:01:30Z', now)).toBe('30s ago');
    expect(relativeSeconds('2026-01-01T00:00:00Z', now)).toBe('2m ago');
    expect(relativeSeconds(null)).toBe('never');
  });
});
