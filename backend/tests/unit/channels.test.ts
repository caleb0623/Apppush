import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  createSimulatedRegistry,
  SimulatedChannel,
  simulatorConfigSchema,
  type SimulatorSettings,
} from '../../src/modules/delivery/channels.js';

const now = new Date('2026-01-01T00:00:00Z');
const clock = () => now;

const request = (overrides = {}) => ({
  msgid: 'm1',
  registrationId: 'device-1',
  platform: 'ANDROID' as const,
  online: true,
  title: 't',
  body: 'b',
  payload: null,
  ...overrides,
});

const channel = (settings: SimulatorSettings) => new SimulatedChannel('fcm', settings, clock);

describe('SimulatedChannel', () => {
  it('supports every required channel identifier', () => {
    expect(CHANNELS).toEqual([
      'fcm',
      'huawei',
      'honor',
      'xiaomi',
      'meizu',
      'oppo',
      'vivo',
      'apns',
      'harmonyos',
      'mtpush',
    ]);
  });

  it('returns a structured, clearly simulated success', async () => {
    const result = await channel({ mode: 'success' }).send(request());
    expect(result).toMatchObject({
      channel: 'fcm',
      provider: 'Google FCM (simulated)',
      outcome: 'DELIVERED',
      timestamp: now,
      failureReason: null,
      simulated: true,
    });
    expect(result.providerMessageId).toMatch(/^sim-/);
  });

  it('reports a configured failure with its reason', async () => {
    const result = await channel({ mode: 'fail', failureReason: 'FCM_DOWN' }).send(request());
    expect(result).toMatchObject({ outcome: 'FAILED', failureReason: 'FCM_DOWN' });
    expect(result.providerMessageId).toBeNull();
  });

  it('reports ACCEPTED, not DELIVERED, for an offline device', async () => {
    expect((await channel({ mode: 'success' }).send(request({ online: false }))).outcome).toBe(
      'ACCEPTED',
    );
  });

  it('supports an accept-only mode', async () => {
    expect((await channel({ mode: 'accept_only' }).send(request())).outcome).toBe('ACCEPTED');
  });

  it('can fail specific devices only', async () => {
    const simulated = channel({ mode: 'success', failRegistrationIds: ['bad'] });
    expect((await simulated.send(request({ registrationId: 'bad' }))).outcome).toBe('FAILED');
    expect((await simulated.send(request())).outcome).toBe('DELIVERED');
  });

  it('gives the same result for the same input with a failure rate', async () => {
    const simulated = channel({ mode: 'success', failureRate: 0.5 });
    const inputs = Array.from({ length: 200 }, (_, i) => request({ registrationId: `d${i}` }));
    const first = await Promise.all(inputs.map((input) => simulated.send(input)));
    const second = await Promise.all(inputs.map((input) => simulated.send(input)));
    expect(first.map((r) => r.outcome)).toEqual(second.map((r) => r.outcome));
    const failed = first.filter((r) => r.outcome === 'FAILED').length;
    expect(failed).toBeGreaterThan(60);
    expect(failed).toBeLessThan(140);
  });

  it('defaults an unconfigured channel to success', async () => {
    const registry = createSimulatedRegistry(clock);
    expect((await registry.get('mtpush', {}).send(request())).outcome).toBe('DELIVERED');
  });

  it('validates simulator configuration', () => {
    expect(simulatorConfigSchema.safeParse({ fcm: { mode: 'fail' } }).success).toBe(true);
    expect(simulatorConfigSchema.safeParse({ pigeon: { mode: 'fail' } }).success).toBe(false);
    expect(simulatorConfigSchema.safeParse({ fcm: { failureRate: 2 } }).success).toBe(false);
  });
});
