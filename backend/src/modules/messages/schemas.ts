import { z } from 'zod';
import { CHANNELS } from '../delivery/channels.js';

export const MAX_CUSTOM_PAYLOAD_BYTES = 4096;

const url = z.string().url().max(500);
const strategies = ['mtpush', 'fcm_mtpush', 'pns_mtpush', 'mtpush_fcm', 'mtpush_pns'] as const;
const styles = ['DEFAULT', 'THUMBNAIL', 'BIG_PICTURE', 'TEXT', 'INBOX', 'CUSTOM'] as const;

/** Each style lists the configuration it needs; DEFAULT takes none. */
const STYLE_CONFIG: Record<(typeof styles)[number], z.ZodTypeAny | null> = {
  DEFAULT: null,
  THUMBNAIL: z.object({ thumbnailUrl: url }).strict(),
  BIG_PICTURE: z.object({ pictureUrl: url }).strict(),
  TEXT: z.object({ bigText: z.string().min(1).max(4000) }).strict(),
  INBOX: z.object({ lines: z.array(z.string().min(1).max(200)).min(1).max(7) }).strict(),
  CUSTOM: z.object({ layoutId: z.string().min(1).max(64) }).strict(),
};

const audienceValues = z.array(z.string().trim().min(1).max(64)).min(1).max(1000);

const audience = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ALL') }).strict(),
  z.object({ type: z.literal('REGISTRATION_IDS'), values: audienceValues }).strict(),
  z.object({ type: z.literal('TAGS'), values: audienceValues }).strict(),
  z.object({ type: z.literal('ALIASES'), values: audienceValues }).strict(),
]);

const messageBody = z
  .object({
    type: z.enum(['NOTIFICATION', 'CUSTOM', 'IN_APP']),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    style: z.enum(styles).default('DEFAULT'),
    styleConfig: z.record(z.unknown()).optional(),
    customPayload: z.record(z.unknown()).optional(),
    platforms: z.array(z.enum(['ANDROID', 'IOS', 'HARMONYOS'])).min(1).max(3),
    audience,
    strategy: z.enum(strategies),
    /** Tries only this channel, instead of the strategy's chain. */
    channel: z.enum(CHANNELS).optional(),
    scheduledAt: z.string().min(1).max(40).optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (new Set(value.platforms).size !== value.platforms.length) {
      issue('platforms', 'Platforms must be unique');
    }

    if (value.type === 'CUSTOM') {
      if (!value.customPayload) {
        issue('customPayload', 'Custom messages require a JSON payload');
      } else if (Buffer.byteLength(JSON.stringify(value.customPayload)) > MAX_CUSTOM_PAYLOAD_BYTES) {
        issue('customPayload', `Payload must not exceed ${MAX_CUSTOM_PAYLOAD_BYTES} bytes`);
      }
    } else {
      if (value.customPayload) issue('customPayload', 'Only custom messages take a payload');
      if (!value.body) issue('body', 'Body is required');
    }
    if (value.type === 'NOTIFICATION' && !value.title) issue('title', 'Title is required');

    if (value.type !== 'NOTIFICATION') {
      if (value.style !== 'DEFAULT') issue('style', 'Only notifications can set a style');
      if (value.styleConfig) issue('styleConfig', 'Only notifications take a style configuration');
      return;
    }

    const configSchema = STYLE_CONFIG[value.style];
    if (!configSchema) {
      if (value.styleConfig) issue('styleConfig', 'The DEFAULT style takes no configuration');
      return;
    }
    const result = configSchema.safeParse(value.styleConfig);
    if (!result.success) {
      for (const problem of result.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['styleConfig', ...problem.path],
          message: value.styleConfig ? problem.message : `The ${value.style} style requires configuration`,
        });
      }
    }
  });

/** `distribution_new` is the platform's published name for the delivery strategy. */
const renameDistribution = (input: unknown) => {
  if (typeof input !== 'object' || input === null || !('distribution_new' in input)) return input;
  const { distribution_new: strategy, ...rest } = input as Record<string, unknown>;
  return { strategy, ...rest };
};

export const createMessageBody = z.preprocess(renameDistribution, messageBody);

export type CreateMessageInput = z.infer<typeof createMessageBody>;

export const listMessagesQuery = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  type: z.enum(['NOTIFICATION', 'CUSTOM', 'IN_APP']).optional(),
  strategy: z.enum(strategies).optional(),
  msgid: z.string().trim().max(32).optional(),
  search: z.string().trim().max(100).optional(),
});

export const recordEventsBody = z
  .object({
    type: z.enum(['DELIVERED', 'DISPLAYED', 'CLICKED']),
    registrationIds: z.array(z.string().min(1).max(64)).min(1).max(1000).optional(),
    /** Without registrationIds, applies to up to this many eligible targets. */
    count: z.number().int().min(1).max(100_000).optional(),
  })
  .strict();
