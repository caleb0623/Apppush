import { createHash, randomUUID } from 'node:crypto';
import type { MessageType, NotificationStyle, Platform, Prisma } from '@prisma/client';
import { z } from 'zod';

export const CHANNELS = [
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
] as const;

export type ChannelId = (typeof CHANNELS)[number];

export const PROVIDER_NAMES: Record<ChannelId, string> = {
  fcm: 'Google FCM',
  huawei: 'Huawei Push Kit',
  honor: 'Honor Push',
  xiaomi: 'Xiaomi Push',
  meizu: 'Meizu Push',
  oppo: 'OPPO Push',
  vivo: 'Vivo Push',
  apns: 'Apple APNs',
  harmonyos: 'HarmonyOS Push Kit',
  mtpush: 'EngageLab',
};

export interface ChannelRequest {
  msgid: string;
  registrationId: string;
  platform: Platform;
  online: boolean;
  title: string | null;
  body: string | null;
  payload: unknown;
  /** Only real adapters read these. */
  pushToken?: string | null;
  messageType?: MessageType;
  style?: NotificationStyle;
  styleConfig?: unknown;
}

/**
 * DELIVERED: accepted, and the simulator stands in for the device's receipt.
 * ACCEPTED: the provider took the message, but no receipt yet. A real provider
 * never returns more than this, because only the device can confirm delivery.
 * FAILED: the provider refused or could not be reached.
 */
export type ChannelOutcome = 'DELIVERED' | 'ACCEPTED' | 'FAILED';

export interface ChannelResult {
  channel: ChannelId;
  provider: string;
  outcome: ChannelOutcome;
  timestamp: Date;
  failureReason: string | null;
  providerMessageId: string | null;
  simulated: boolean;
  /** The provider's own answer, kept on the attempt as evidence. */
  providerResponse?: Prisma.InputJsonValue;
  /** The provider says this device's push token can never work again. */
  tokenInvalid?: boolean;
}

/** The seam for providers. FcmChannel is the real adapter; the rest are simulated. */
export interface PushChannel {
  readonly id: ChannelId;
  send(request: ChannelRequest): Promise<ChannelResult>;
}

export const simulatorSettingsSchema = z
  .object({
    mode: z.enum(['success', 'fail', 'accept_only']).default('success'),
    failureReason: z.string().trim().min(1).max(120).optional(),
    /** Share of sends that fail, decided by a hash so that reruns give the same result. */
    failureRate: z.number().min(0).max(1).optional(),
    failRegistrationIds: z.array(z.string().max(64)).max(1000).optional(),
  })
  .strict();

export type SimulatorSettings = z.infer<typeof simulatorSettingsSchema>;

export const simulatorConfigSchema = z.record(z.enum(CHANNELS), simulatorSettingsSchema);
export type SimulatorConfig = z.infer<typeof simulatorConfigSchema>;

const SAMPLE_FAILURES = [
  'INVALID_TOKEN',
  'DEVICE_UNREGISTERED',
  'PROVIDER_THROTTLED',
  'PROVIDER_UNAVAILABLE',
];

/** Maps text to a stable number in [0, 1). */
function stableFraction(input: string): number {
  return createHash('sha256').update(input).digest().readUInt32BE(0) / 2 ** 32;
}

export class SimulatedChannel implements PushChannel {
  constructor(
    public readonly id: ChannelId,
    private readonly settings: SimulatorSettings,
    private readonly clock: () => Date,
  ) {}

  async send(request: ChannelRequest): Promise<ChannelResult> {
    const failureReason = this.failureFor(request);
    const accepted = failureReason === null;
    let outcome: ChannelOutcome = 'FAILED';
    if (accepted) {
      outcome = this.settings.mode === 'accept_only' || !request.online ? 'ACCEPTED' : 'DELIVERED';
    }
    return {
      channel: this.id,
      provider: `${PROVIDER_NAMES[this.id]} (simulated)`,
      outcome,
      timestamp: this.clock(),
      failureReason,
      providerMessageId: accepted ? `sim-${randomUUID()}` : null,
      simulated: true,
    };
  }

  private failureFor(request: ChannelRequest): string | null {
    const { mode, failureReason, failureRate, failRegistrationIds } = this.settings;
    if (mode === 'fail') return failureReason ?? 'SIMULATED_PROVIDER_FAILURE';
    if (failRegistrationIds?.includes(request.registrationId)) {
      return failureReason ?? 'SIMULATED_DEVICE_FAILURE';
    }
    if (failureRate) {
      const key = `${request.msgid}:${request.registrationId}:${this.id}`;
      if (stableFraction(key) < failureRate) {
        return failureReason ?? SAMPLE_FAILURES[Math.floor(stableFraction(`${key}:why`) * 4)]!;
      }
    }
    return null;
  }
}

export interface ChannelRegistry {
  get(channel: ChannelId, config: SimulatorConfig): PushChannel;
}

export const createSimulatedRegistry = (clock: () => Date): ChannelRegistry => ({
  get: (channel, config) =>
    new SimulatedChannel(channel, config[channel] ?? { mode: 'success' }, clock),
});
