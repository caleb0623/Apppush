import { describe, expect, it } from 'vitest';
import { createMessageBody, MAX_CUSTOM_PAYLOAD_BYTES } from '../../src/modules/messages/schemas.js';

const base = {
  type: 'NOTIFICATION',
  title: 'Title',
  body: 'Body',
  platforms: ['ANDROID'],
  audience: { type: 'ALL' },
  strategy: 'mtpush',
};

const errorFields = (input: object) => {
  const result = createMessageBody.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('message payload validation', () => {
  it('accepts a minimal notification and defaults the style', () => {
    expect(createMessageBody.parse(base).style).toBe('DEFAULT');
  });

  it('requires a title and body on notifications', () => {
    expect(errorFields({ ...base, title: undefined })).toContain('title');
    expect(errorFields({ ...base, body: undefined })).toContain('body');
  });

  it.each([
    ['THUMBNAIL', { thumbnailUrl: 'https://x.test/a.png' }],
    ['BIG_PICTURE', { pictureUrl: 'https://x.test/a.png' }],
    ['TEXT', { bigText: 'Long text' }],
    ['INBOX', { lines: ['one', 'two'] }],
    ['CUSTOM', { layoutId: 'promo_v1' }],
  ])('accepts valid configuration for %s', (style, styleConfig) => {
    expect(createMessageBody.safeParse({ ...base, style, styleConfig }).success).toBe(true);
  });

  it.each(['THUMBNAIL', 'BIG_PICTURE', 'TEXT', 'INBOX', 'CUSTOM'])(
    'rejects %s without configuration',
    (style) => {
      expect(errorFields({ ...base, style })[0]).toMatch(/^styleConfig/);
    },
  );

  it('rejects a malformed style URL and too many inbox lines', () => {
    expect(
      errorFields({ ...base, style: 'BIG_PICTURE', styleConfig: { pictureUrl: 'nope' } }),
    ).toContain('styleConfig.pictureUrl');
    expect(
      errorFields({ ...base, style: 'INBOX', styleConfig: { lines: Array(8).fill('x') } }),
    ).toContain('styleConfig.lines');
  });

  it('rejects configuration on the DEFAULT style', () => {
    expect(errorFields({ ...base, styleConfig: { pictureUrl: 'https://x.test' } })).toContain(
      'styleConfig',
    );
  });

  it('requires a JSON payload on custom messages and limits its size', () => {
    const custom = { ...base, type: 'CUSTOM', title: undefined, body: undefined };
    expect(errorFields(custom)).toContain('customPayload');
    expect(createMessageBody.safeParse({ ...custom, customPayload: { a: 1 } }).success).toBe(true);
    const huge = { blob: 'x'.repeat(MAX_CUSTOM_PAYLOAD_BYTES) };
    expect(errorFields({ ...custom, customPayload: huge })).toContain('customPayload');
  });

  it('rejects a payload on other message types', () => {
    expect(errorFields({ ...base, customPayload: { a: 1 } })).toContain('customPayload');
  });

  it('allows a style only on notifications', () => {
    expect(
      errorFields({
        ...base,
        type: 'IN_APP',
        style: 'TEXT',
        styleConfig: { bigText: 'x' },
      }),
    ).toEqual(expect.arrayContaining(['style', 'styleConfig']));
  });

  it('rejects unknown strategies, platforms and audience shapes', () => {
    expect(errorFields({ ...base, strategy: 'carrier_pigeon' })).toContain('strategy');
    expect(errorFields({ ...base, platforms: ['WINDOWS'] })).toContain('platforms.0');
    expect(errorFields({ ...base, platforms: [] })).toContain('platforms');
    expect(errorFields({ ...base, platforms: ['IOS', 'IOS'] })).toContain('platforms');
    expect(errorFields({ ...base, audience: { type: 'TAGS', values: [] } })).toContain(
      'audience.values',
    );
  });

  it('rejects unknown top-level fields', () => {
    expect(createMessageBody.safeParse({ ...base, surprise: true }).success).toBe(false);
  });
});
