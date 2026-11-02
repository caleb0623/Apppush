import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../src/modules/delivery/channels.js';
import { buildChannelPlan } from '../../src/modules/delivery/strategy.js';

const android = (vendor: string | null) => ({ platform: 'ANDROID' as const, vendor });
const ios = { platform: 'IOS' as const, vendor: 'apple' };
const harmony = { platform: 'HARMONYOS' as const, vendor: 'huawei' };

const channels = (plan: ReturnType<typeof buildChannelPlan>) => plan.map((s) => s.channel);

describe('buildChannelPlan', () => {
  it.each([
    ['mtpush', ['mtpush']],
    ['fcm_mtpush', ['fcm', 'mtpush']],
    ['pns_mtpush', ['xiaomi', 'mtpush']],
    ['mtpush_fcm', ['mtpush', 'fcm']],
    ['mtpush_pns', ['mtpush', 'xiaomi']],
  ] as const)('orders %s for an Android device', (strategy, expected) => {
    expect(channels(buildChannelPlan(strategy, android('xiaomi'), CHANNELS))).toEqual(expected);
  });

  it('marks only later steps as fallback', () => {
    const plan = buildChannelPlan('fcm_mtpush', android(null), CHANNELS);
    expect(plan.map((s) => s.isFallback)).toEqual([false, true]);
  });

  it.each(['xiaomi', 'huawei', 'honor', 'meizu', 'oppo', 'vivo'])(
    'routes %s devices to their manufacturer channel',
    (vendor) => {
      expect(buildChannelPlan('pns_mtpush', android(vendor), CHANNELS)[0]?.channel).toBe(vendor);
    },
  );

  it('matches vendors case-insensitively', () => {
    expect(buildChannelPlan('pns_mtpush', android('XiaoMi'), CHANNELS)[0]?.channel).toBe('xiaomi');
  });

  it('skips the manufacturer slot for an unsupported vendor', () => {
    expect(buildChannelPlan('pns_mtpush', android('samsung'), CHANNELS)).toEqual([
      { channel: 'pns', isFallback: false, skipReason: 'NO_MANUFACTURER_CHANNEL' },
      { channel: 'mtpush', isFallback: true, skipReason: null },
    ]);
  });

  it('maps FCM and manufacturer slots to the system channel on iOS and HarmonyOS', () => {
    expect(channels(buildChannelPlan('fcm_mtpush', ios, CHANNELS))).toEqual(['apns', 'mtpush']);
    expect(channels(buildChannelPlan('pns_mtpush', ios, CHANNELS))).toEqual(['apns', 'mtpush']);
    expect(channels(buildChannelPlan('mtpush_pns', harmony, CHANNELS))).toEqual([
      'mtpush',
      'harmonyos',
    ]);
  });

  it('marks disabled channels as skipped', () => {
    const plan = buildChannelPlan('fcm_mtpush', android(null), ['mtpush']);
    expect(plan[0]).toMatchObject({ channel: 'fcm', skipReason: 'CHANNEL_DISABLED' });
    expect(plan[1]).toMatchObject({ channel: 'mtpush', skipReason: null });
  });

  it('never plans more than two steps or repeats a channel', () => {
    for (const strategy of ['mtpush', 'fcm_mtpush', 'pns_mtpush', 'mtpush_fcm', 'mtpush_pns'] as const) {
      const plan = channels(buildChannelPlan(strategy, android('vivo'), CHANNELS));
      expect(plan.length).toBeLessThanOrEqual(2);
      expect(new Set(plan).size).toBe(plan.length);
    }
  });
});
