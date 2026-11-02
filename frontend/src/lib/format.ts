import { locale, t, translate, type MessageKey } from '@/lib/i18n';

export const formatNumber = (value: number): string => value.toLocaleString('en-US');

export const formatRate = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;

export const formatDateTime = (value: string | null | undefined, timezone?: string): string => {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale.value === 'zh' ? 'zh-CN' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
};

export const relativeSeconds = (value: string | null | undefined, now = Date.now()): string => {
  if (!value) return t('never');
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  return seconds < 60 ? t('{count}s ago', { count: seconds }) : t('{count}m ago', { count: Math.round(seconds / 60) });
};

export const splitList = (text: string): string[] =>
  [...new Set(text.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean))];

export const CHANNEL_LABELS: Record<string, string> = {
  fcm: 'FCM',
  huawei: 'Huawei',
  honor: 'Honor',
  xiaomi: 'Xiaomi',
  meizu: 'Meizu',
  oppo: 'OPPO',
  vivo: 'Vivo',
  apns: 'APNs',
  harmonyos: 'HarmonyOS',
  mtpush: 'EngageLab',
  pns: 'Manufacturer',
};

export const channelLabel = (id: string | null | undefined): string =>
  id ? translate(CHANNEL_LABELS[id] ?? id) : '—';

/** Turns a stored value such as IN_APP into words, in the current language. */
export const valueLabel = (value: string): string =>
  translate(value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' '));

export const environmentName = (type: string | undefined): string => (type ? translate(type.toLowerCase()) : '');

export const roleLabel = (role: string): string => (role === 'ADMIN' ? t('Administrator') : t('Viewer'));

export const messageTitle = (message: { title?: string | null; type: string }): string =>
  message.title ?? t('{type} message', { type: valueLabel(message.type) });

const AUDIENCE_LABELS: Record<string, MessageKey> = {
  ALL: 'All devices',
  REGISTRATION_IDS: 'Selected devices',
  TAGS: 'Tags',
  ALIASES: 'Aliases',
};

export const audienceLabel = (type: string): string => {
  const label = AUDIENCE_LABELS[type];
  return label ? t(label) : type;
};

/** What each funnel stage means for a real device, and who vouches for it. */
export const EVENT_STAGES = [
  { type: 'SENT', label: 'Accepted by provider' },
  { type: 'DELIVERED', label: 'Received by device' },
  { type: 'DISPLAYED', label: 'Displayed' },
  { type: 'CLICKED', label: 'Clicked' },
] as const;

export const EVENT_SOURCE_LABELS: Record<string, string> = {
  PROVIDER: 'provider response',
  DEVICE_CLIENT: 'reported by the device',
  DELIVERY_SIMULATOR: 'simulator',
  MANUAL_SIMULATION: 'manual simulation',
};

/** Says who vouches for a stage, because "sent" by Google and "displayed" by a phone differ. */
export const eventLabel = (event: { type: string; source: string; inferred: boolean }): string => {
  const stage = EVENT_STAGES.find((item) => item.type === event.type);
  const source = translate(EVENT_SOURCE_LABELS[event.source] ?? event.source);
  return t('{label} ({source})', {
    label: stage ? t(stage.label) : event.type,
    source: event.inferred ? t('{source}, inferred', { source }) : source,
  });
};

/** Channels a sender can pick; `pns` is only a slot inside a strategy. */
export const CHANNEL_CHOICES = Object.keys(CHANNEL_LABELS).filter((id) => id !== 'pns');

/** FCM is the only channel that can reach a real device. An override replaces the strategy's chain. */
export const reachesRealDevice = (strategy: string, channel = ''): boolean =>
  channel ? channel === 'fcm' : strategy.includes('fcm');

export const STRATEGIES = [
  { id: 'mtpush', label: 'EngageLab only', chain: 'EngageLab' },
  { id: 'fcm_mtpush', label: 'FCM first', chain: 'FCM, then EngageLab on failure' },
  { id: 'pns_mtpush', label: 'Manufacturer first', chain: 'Manufacturer channel, then EngageLab on failure' },
  { id: 'mtpush_fcm', label: 'EngageLab, then FCM', chain: 'EngageLab, or FCM if EngageLab is not online' },
  { id: 'mtpush_pns', label: 'EngageLab, then manufacturer', chain: 'EngageLab, or the manufacturer channel if EngageLab is not online' },
] as const;

const FAILURE_STAGES: Record<string, MessageKey> = {
  INVALID_TARGET: 'Invalid target',
  SEND_FAILED: 'Send failed',
  DISPLAY_FAILED: 'Reached the device, not shown',
};

export const failureStage = (stage: string): string => {
  const label = FAILURE_STAGES[stage];
  return label ? t(label) : stage;
};
