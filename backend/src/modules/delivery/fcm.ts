import type { TokenMessage } from 'firebase-admin/messaging';
import type { ChannelRequest, ChannelResult, PushChannel } from './channels.js';
import { PROVIDER_NAMES } from './channels.js';

/** Must match the channel the Android app creates. */
export const ANDROID_CHANNEL_ID = 'apppush_default';

/** FCM refuses more than 4 KB of data; this leaves room for its own envelope. */
const MAX_DATA_BYTES = 4000;

export type FcmPayloadMode = 'data' | 'hybrid';

export interface FcmOptions {
  mode: FcmPayloadMode;
  ttlSeconds: number;
  timeoutMs: number;
}

/** The only code that talks to Firebase sits behind this, so tests can never reach it. */
export interface FcmSender {
  readonly projectId: string;
  send(message: TokenMessage, dryRun?: boolean): Promise<string>;
}

/**
 * Data-only by default: Android then calls the app for every message, in the
 * background too, so it can report receipt and draw the requested style. A
 * `notification` block would hide background messages from the app.
 * Hybrid adds that block for phones whose vendor kills background apps.
 */
export function buildFcmMessage(request: ChannelRequest, options: FcmOptions): TokenMessage {
  const type = request.messageType ?? 'NOTIFICATION';
  const visible = type === 'NOTIFICATION';
  const data: Record<string, string> = {
    msgid: request.msgid,
    type,
    style: request.style ?? 'DEFAULT',
  };
  if (request.title) data.title = request.title;
  if (request.body) data.body = request.body;
  // FCM data values must be strings, so structured values travel as JSON text.
  if (request.styleConfig) data.styleConfig = JSON.stringify(request.styleConfig);
  if (request.payload) data.payload = JSON.stringify(request.payload);

  const hybrid = visible && options.mode === 'hybrid';
  return {
    token: request.pushToken!,
    data,
    ...(hybrid ? { notification: { title: request.title ?? '', body: request.body ?? '' } } : {}),
    android: {
      // Reserved for visible messages: Android demotes apps that wake the phone for nothing.
      priority: visible ? 'high' : 'normal',
      ttl: options.ttlSeconds * 1000,
      // A retried send replaces the undelivered copy instead of adding a second one.
      collapseKey: request.msgid,
      ...(hybrid ? { notification: { channelId: ANDROID_CHANNEL_ID, tag: request.msgid } } : {}),
    },
  };
}

interface FcmFailure {
  reason: string;
  tokenInvalid: boolean;
}

const FAILURE_BY_CODE: Record<string, FcmFailure> = {
  'messaging/registration-token-not-registered': { reason: 'TOKEN_UNREGISTERED', tokenInvalid: true },
  'messaging/invalid-registration-token': { reason: 'TOKEN_INVALID', tokenInvalid: true },
  // The token works, but for another Firebase project: a setup mistake, not a dead device.
  'messaging/mismatched-credential': { reason: 'SENDER_ID_MISMATCH', tokenInvalid: false },
  'messaging/message-rate-exceeded': { reason: 'PROVIDER_THROTTLED', tokenInvalid: false },
  'messaging/device-message-rate-exceeded': { reason: 'PROVIDER_THROTTLED', tokenInvalid: false },
  'messaging/server-unavailable': { reason: 'PROVIDER_UNAVAILABLE', tokenInvalid: false },
  'messaging/internal-error': { reason: 'PROVIDER_INTERNAL_ERROR', tokenInvalid: false },
  'messaging/third-party-auth-error': { reason: 'THIRD_PARTY_AUTH_ERROR', tokenInvalid: false },
  'messaging/authentication-error': { reason: 'FCM_AUTH_ERROR', tokenInvalid: false },
  'app/invalid-credential': { reason: 'FCM_AUTH_ERROR', tokenInvalid: false },
  'app/network-error': { reason: 'NETWORK_ERROR', tokenInvalid: false },
  'app/network-timeout': { reason: 'NETWORK_ERROR', tokenInvalid: false },
};

export function classifyFcmError(error: unknown): FcmFailure {
  const { code = '', message = '' } = (error ?? {}) as { code?: string; message?: string };
  if (code === 'messaging/invalid-argument') {
    // FCM uses this one code for a bad token and for a bad payload.
    return /registration token/i.test(message)
      ? { reason: 'TOKEN_INVALID', tokenInvalid: true }
      : { reason: 'INVALID_ARGUMENT', tokenInvalid: false };
  }
  if (FAILURE_BY_CODE[code]) return FAILURE_BY_CODE[code];
  if (/^E[A-Z]+$/.test(code)) return { reason: 'NETWORK_ERROR', tokenInvalid: false };
  return { reason: `FCM_ERROR: ${code || message || 'unknown'}`.slice(0, 255), tokenInvalid: false };
}

class FcmTimeoutError extends Error {
  readonly code = 'FCM_TIMEOUT';
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new FcmTimeoutError(`No answer in ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export class FcmChannel implements PushChannel {
  readonly id = 'fcm' as const;

  constructor(
    private readonly sender: FcmSender | null,
    private readonly options: FcmOptions,
    private readonly clock: () => Date,
  ) {}

  private failed(
    failureReason: string,
    extra: Pick<ChannelResult, 'providerResponse' | 'tokenInvalid'> = {},
  ): ChannelResult {
    return {
      channel: this.id,
      provider: PROVIDER_NAMES.fcm,
      outcome: 'FAILED',
      timestamp: this.clock(),
      failureReason,
      providerMessageId: null,
      simulated: false,
      ...extra,
    };
  }

  async send(request: ChannelRequest): Promise<ChannelResult> {
    if (!this.sender) return this.failed('FCM_NOT_CONFIGURED');
    if (!request.pushToken) return this.failed('NO_PUSH_TOKEN');

    const message = buildFcmMessage(request, this.options);
    if (Buffer.byteLength(JSON.stringify(message.data)) > MAX_DATA_BYTES) {
      return this.failed('PAYLOAD_TOO_LARGE');
    }

    try {
      const name = await withTimeout(this.sender.send(message), this.options.timeoutMs);
      return {
        channel: this.id,
        provider: PROVIDER_NAMES.fcm,
        // Acceptance by Google says nothing about the phone, so this is never DELIVERED.
        outcome: 'ACCEPTED',
        timestamp: this.clock(),
        failureReason: null,
        providerMessageId: name,
        simulated: false,
        providerResponse: { name, projectId: this.sender.projectId },
      };
    } catch (error) {
      const { reason, tokenInvalid } = error instanceof FcmTimeoutError
        ? { reason: 'FCM_TIMEOUT', tokenInvalid: false }
        : classifyFcmError(error);
      const { code, message: detail } = error as { code?: string; message?: string };
      return this.failed(reason, {
        tokenInvalid,
        // Tokens are credentials for the device, so they stay out of stored responses.
        providerResponse: {
          code: code ?? 'unknown',
          message: (detail ?? '').replaceAll(request.pushToken, '[token]').slice(0, 500),
        },
      });
    }
  }
}
