import type { DeliveryStrategy, Platform } from '@prisma/client';
import type { ChannelId } from './channels.js';

type Slot = 'mtpush' | 'fcm' | 'pns';

const STRATEGY_SLOTS: Record<DeliveryStrategy, readonly Slot[]> = {
  mtpush: ['mtpush'],
  fcm_mtpush: ['fcm', 'mtpush'],
  pns_mtpush: ['pns', 'mtpush'],
  mtpush_fcm: ['mtpush', 'fcm'],
  mtpush_pns: ['mtpush', 'pns'],
};

/** Honor is included because it is a listed channel; see requirements A-01. */
const MANUFACTURER_BY_VENDOR: Record<string, ChannelId> = {
  xiaomi: 'xiaomi',
  huawei: 'huawei',
  honor: 'honor',
  meizu: 'meizu',
  oppo: 'oppo',
  vivo: 'vivo',
};

const SYSTEM_CHANNEL: Partial<Record<Platform, ChannelId>> = {
  IOS: 'apns',
  HARMONYOS: 'harmonyos',
};

export interface PlanDevice {
  platform: Platform;
  vendor: string | null;
  /** Whether the device holds a live EngageLab connection. */
  online?: boolean;
}

export interface PlanStep {
  /** The channel to call, or the slot's name when it could not be resolved. */
  channel: string;
  isFallback: boolean;
  /** When set, the step is recorded but no provider is called. */
  skipReason: string | null;
}

function resolveSlot(slot: Slot, device: PlanDevice): ChannelId | null {
  if (slot === 'mtpush') return 'mtpush';
  const system = SYSTEM_CHANNEL[device.platform];
  if (system) return system;
  if (slot === 'fcm') return 'fcm';
  return MANUFACTURER_BY_VENDOR[device.vendor?.toLowerCase() ?? ''] ?? null;
}

function channelApplies(channel: string, device: PlanDevice): boolean {
  if (channel === 'mtpush') return true;
  const system = SYSTEM_CHANNEL[device.platform];
  if (system) return channel === system;
  return channel === 'fcm' || channel === MANUFACTURER_BY_VENDOR[device.vendor?.toLowerCase() ?? ''];
}

const enabledStep = (channel: string, isFallback: boolean, enabled: readonly string[]): PlanStep => ({
  channel,
  isFallback,
  skipReason: enabled.includes(channel) ? null : 'CHANNEL_DISABLED',
});

/**
 * Builds the ordered, bounded channel plan for one device. There are at most
 * two steps, and each channel appears once, so fallback cannot loop. A channel
 * override replaces the strategy's chain with that one channel.
 */
export function buildChannelPlan(
  strategy: DeliveryStrategy,
  device: PlanDevice,
  enabledChannels: readonly string[],
  channelOverride: string | null = null,
): PlanStep[] {
  if (channelOverride) {
    return channelApplies(channelOverride, device)
      ? [enabledStep(channelOverride, false, enabledChannels)]
      : [{ channel: channelOverride, isFallback: false, skipReason: 'CHANNEL_NOT_APPLICABLE' }];
  }
  const slots = STRATEGY_SLOTS[strategy];
  return slots.map((slot, index) => {
    const channel = resolveSlot(slot, device);
    const isFallback = index > 0;
    if (channel === null) {
      return { channel: slot, isFallback, skipReason: 'NO_MANUFACTURER_CHANNEL' };
    }
    const step = enabledStep(channel, isFallback, enabledChannels);
    // mtpush_fcm and mtpush_pns use the other channel when EngageLab is not online.
    // Plain mtpush has no other channel, so it still accepts and waits for the device.
    const offlineFirst = slot === 'mtpush' && index === 0 && slots.length > 1;
    if (offlineFirst && device.online === false && !step.skipReason) {
      return { ...step, skipReason: 'MTPUSH_OFFLINE' };
    }
    return step;
  });
}
