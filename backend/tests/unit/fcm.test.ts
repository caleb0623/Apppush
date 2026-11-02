import { describe, expect, it, vi } from 'vitest';
import {
  ANDROID_CHANNEL_ID,
  buildFcmMessage,
  classifyFcmError,
  FcmChannel,
  type FcmOptions,
  type FcmSender,
} from '../../src/modules/delivery/fcm.js';
import { loadFcmSetup, loadServiceAccount } from '../../src/modules/delivery/firebase.js';

const options: FcmOptions = { mode: 'data', ttlSeconds: 60, timeoutMs: 50 };
const now = new Date('2026-01-01T00:00:00Z');
const clock = () => now;
const TOKEN = 'token-abcdefghijklmnopqrstuvwxyz';

const request = (overrides = {}) => ({
  msgid: '1760000000000123456',
  registrationId: 'rid_1',
  platform: 'ANDROID' as const,
  online: true,
  title: 'Hello',
  body: 'World',
  payload: null,
  pushToken: TOKEN,
  messageType: 'NOTIFICATION' as const,
  style: 'DEFAULT' as const,
  styleConfig: null,
  ...overrides,
});

const sender = (send: FcmSender['send']): FcmSender => ({ projectId: 'demo-project', send });

describe('buildFcmMessage', () => {
  it('sends a data-only, high-priority message by default', () => {
    const message = buildFcmMessage(request(), options);
    expect(message.notification).toBeUndefined();
    expect(message.token).toBe(TOKEN);
    expect(message.android).toEqual({
      priority: 'high',
      ttl: 60_000,
      collapseKey: '1760000000000123456',
    });
    expect(message.data).toEqual({
      msgid: '1760000000000123456',
      type: 'NOTIFICATION',
      style: 'DEFAULT',
      title: 'Hello',
      body: 'World',
    });
  });

  it('adds a notification block in hybrid mode', () => {
    const message = buildFcmMessage(request(), { ...options, mode: 'hybrid' });
    expect(message.notification).toEqual({ title: 'Hello', body: 'World' });
    expect(message.android?.notification).toMatchObject({
      channelId: ANDROID_CHANNEL_ID,
      tag: '1760000000000123456',
    });
    expect(message.data?.msgid).toBe('1760000000000123456');
  });

  it('never adds a visible block to custom or in-app messages', () => {
    for (const messageType of ['CUSTOM', 'IN_APP'] as const) {
      const message = buildFcmMessage(request({ messageType }), { ...options, mode: 'hybrid' });
      expect(message.notification).toBeUndefined();
      expect(message.android?.priority).toBe('normal');
    }
  });

  it('carries structured values as JSON strings, since FCM data must be strings', () => {
    const { data } = buildFcmMessage(
      request({
        messageType: 'CUSTOM',
        style: 'INBOX',
        styleConfig: { lines: ['a'] },
        payload: { action: 'refresh', n: 1 },
      }),
      options,
    );
    expect(data?.styleConfig).toBe('{"lines":["a"]}');
    expect(data?.payload).toBe('{"action":"refresh","n":1}');
    expect(Object.values(data ?? {}).every((value) => typeof value === 'string')).toBe(true);
  });
});

describe('classifyFcmError', () => {
  it.each([
    ['messaging/registration-token-not-registered', 'x', 'TOKEN_UNREGISTERED', true],
    ['messaging/invalid-registration-token', 'x', 'TOKEN_INVALID', true],
    ['messaging/invalid-argument', 'The registration token is not a valid FCM registration token', 'TOKEN_INVALID', true],
    ['messaging/invalid-argument', 'Request contains an invalid argument', 'INVALID_ARGUMENT', false],
    ['messaging/mismatched-credential', 'x', 'SENDER_ID_MISMATCH', false],
    ['messaging/message-rate-exceeded', 'x', 'PROVIDER_THROTTLED', false],
    ['messaging/device-message-rate-exceeded', 'x', 'PROVIDER_THROTTLED', false],
    ['messaging/server-unavailable', 'x', 'PROVIDER_UNAVAILABLE', false],
    ['messaging/internal-error', 'x', 'PROVIDER_INTERNAL_ERROR', false],
    ['messaging/third-party-auth-error', 'x', 'THIRD_PARTY_AUTH_ERROR', false],
    ['messaging/authentication-error', 'x', 'FCM_AUTH_ERROR', false],
    ['app/invalid-credential', 'x', 'FCM_AUTH_ERROR', false],
    ['app/network-error', 'x', 'NETWORK_ERROR', false],
    ['ECONNRESET', 'x', 'NETWORK_ERROR', false],
    ['ETIMEDOUT', 'x', 'NETWORK_ERROR', false],
  ])('maps %s (%s)', (code, message, reason, tokenInvalid) => {
    expect(classifyFcmError({ code, message })).toEqual({ reason, tokenInvalid });
  });

  it('keeps an unknown code visible rather than hiding it', () => {
    expect(classifyFcmError({ code: 'messaging/new-thing' }).reason).toBe('FCM_ERROR: messaging/new-thing');
    expect(classifyFcmError(new Error('boom')).reason).toBe('FCM_ERROR: boom');
  });
});

describe('FcmChannel', () => {
  it('reports acceptance only, because Google cannot vouch for the phone', async () => {
    const send = vi.fn().mockResolvedValue('projects/demo-project/messages/0:123');
    const result = await new FcmChannel(sender(send), options, clock).send(request());
    expect(result).toMatchObject({
      channel: 'fcm',
      provider: 'Google FCM',
      outcome: 'ACCEPTED',
      simulated: false,
      failureReason: null,
      providerMessageId: 'projects/demo-project/messages/0:123',
      providerResponse: { name: 'projects/demo-project/messages/0:123', projectId: 'demo-project' },
      timestamp: now,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('fails without calling anything when Firebase is not configured', async () => {
    expect(await new FcmChannel(null, options, clock).send(request())).toMatchObject({
      outcome: 'FAILED',
      failureReason: 'FCM_NOT_CONFIGURED',
      simulated: false,
    });
  });

  it('fails when the device has no token', async () => {
    const send = vi.fn();
    const result = await new FcmChannel(sender(send), options, clock).send(request({ pushToken: null }));
    expect(result.failureReason).toBe('NO_PUSH_TOKEN');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a payload FCM would reject, without calling it', async () => {
    const send = vi.fn();
    const result = await new FcmChannel(sender(send), options, clock).send(
      request({ body: 'x'.repeat(4000) }),
    );
    expect(result.failureReason).toBe('PAYLOAD_TOO_LARGE');
    expect(send).not.toHaveBeenCalled();
  });

  it('flags a dead token and keeps the provider error as evidence', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('Requested entity was not found.'), {
        code: 'messaging/registration-token-not-registered',
      }),
    );
    expect(await new FcmChannel(sender(send), options, clock).send(request())).toMatchObject({
      outcome: 'FAILED',
      failureReason: 'TOKEN_UNREGISTERED',
      tokenInvalid: true,
      providerResponse: {
        code: 'messaging/registration-token-not-registered',
        message: 'Requested entity was not found.',
      },
    });
  });

  it('never stores the token, even if an error repeats it', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error(`bad token ${TOKEN}`), { code: 'messaging/internal-error' }),
    );
    const result = await new FcmChannel(sender(send), options, clock).send(request());
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('gives up on a provider that never answers', async () => {
    const send = vi.fn(() => new Promise<string>(() => undefined));
    expect(await new FcmChannel(sender(send), options, clock).send(request())).toMatchObject({
      outcome: 'FAILED',
      failureReason: 'FCM_TIMEOUT',
      tokenInvalid: false,
    });
  });
});

describe('Firebase credentials', () => {
  const account = {
    type: 'service_account',
    project_id: 'demo-project',
    client_email: 'push@demo-project.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  };

  it('treats no configuration as "not set up", not an error', () => {
    expect(loadServiceAccount({})).toBeNull();
  });

  it('reads raw and base64 JSON', () => {
    const raw = JSON.stringify(account);
    expect(loadServiceAccount({ json: raw })?.project_id).toBe('demo-project');
    expect(
      loadServiceAccount({ json: Buffer.from(raw).toString('base64') })?.project_id,
    ).toBe('demo-project');
  });

  it('names bad fields without printing the key', () => {
    const bad = JSON.stringify({ ...account, private_key: 'not-a-key-secret-value' });
    expect(() => loadServiceAccount({ json: bad })).toThrow(/private_key/);
    expect(() => loadServiceAccount({ json: bad })).not.toThrow(/secret-value/);
  });

  it('rejects other kinds of Google JSON, such as google-services.json', () => {
    expect(() => loadServiceAccount({ json: '{"project_info":{}}' })).toThrow(/type/);
  });

  it('explains an unreadable file', () => {
    expect(() => loadServiceAccount({ path: './no-such-file.json' })).toThrow(/Cannot read/);
  });

  it('can never produce a real sender during tests', () => {
    expect(loadFcmSetup()).toEqual({ sender: null, problem: null });
  });
});
