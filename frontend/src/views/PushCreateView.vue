<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiRequestError, errorMessage } from '@/api/client';
import type { Device, Message } from '@/api/types';
import { useResource } from '@/composables/useResource';
import { CHANNEL_CHOICES, STRATEGIES, channelLabel, environmentName, reachesRealDevice, splitList, valueLabel } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { useToastStore } from '@/stores/toast';
import { useWorkspaceStore } from '@/stores/workspace';

const workspace = useWorkspaceStore();
const toast = useToastStore();
const router = useRouter();

const STYLE_FIELDS: Record<string, { key: string; label: MessageKey; help: MessageKey; multiline?: boolean } | null> = {
  DEFAULT: null,
  THUMBNAIL: { key: 'thumbnailUrl', label: 'Thumbnail URL', help: 'Image shown beside the text' },
  BIG_PICTURE: { key: 'pictureUrl', label: 'Picture URL', help: 'Large image shown when expanded' },
  TEXT: { key: 'bigText', label: 'Expanded text', help: 'Long text shown when expanded', multiline: true },
  INBOX: { key: 'lines', label: 'Inbox lines', help: 'One line per row, up to 7', multiline: true },
  CUSTOM: { key: 'layoutId', label: 'Layout ID', help: 'Identifier of a custom layout' },
};

const form = reactive({
  type: 'NOTIFICATION',
  title: '',
  body: '',
  style: 'DEFAULT',
  styleValue: '',
  customPayload: '{\n  "action": "refresh"\n}',
  platforms: ['ANDROID', 'IOS', 'HARMONYOS'],
  audienceType: 'ALL',
  audienceValues: '',
  selectedDevices: [] as string[],
  strategy: 'fcm_mtpush',
  channel: '',
  delivery: 'now',
  scheduledAt: '',
});

// Real phones come first, because they are usually the point of a manual send.
const devices = useResource(() => api.get<Device[]>(`${workspace.envUrl}/devices?pageSize=100`));
const deviceChoices = computed(() =>
  [...(devices.data.value ?? [])].sort((a, b) => a.deliveryMode.localeCompare(b.deliveryMode)),
);

/** A real phone in the audience, when the delivery plan could never reach it. */
const unreachablePhone = computed(() => {
  const phones = deviceChoices.value.filter((d) => d.deliveryMode === 'REAL');
  const targeted =
    form.audienceType === 'REGISTRATION_IDS'
      ? phones.some((d) => form.selectedDevices.includes(d.registrationId))
      : phones.length > 0;
  return targeted && !reachesRealDevice(form.strategy, form.channel);
});

const errors = ref<Record<string, string>>({});
const formError = ref<string | null>(null);
const busy = ref(false);
// Kept for the life of the form, so a double submit or a retry cannot send twice.
let idempotencyKey = crypto.randomUUID();

const styleField = computed(() => STYLE_FIELDS[form.style] ?? null);
const strategy = computed(() => STRATEGIES.find((s) => s.id === form.strategy));
const isNotification = computed(() => form.type === 'NOTIFICATION');

function validate(): Record<string, unknown> | null {
  const problems: Record<string, string> = {};
  let customPayload: unknown;

  if (isNotification.value && !form.title.trim()) problems.title = t('Title is required');
  if (form.type !== 'CUSTOM' && !form.body.trim()) problems.body = t('Body is required');
  if (form.platforms.length === 0) problems.platforms = t('Select at least one platform');
  if (form.audienceType === 'REGISTRATION_IDS') {
    if (form.selectedDevices.length === 0) problems['audience.values'] = t('Select at least one device');
  } else if (form.audienceType !== 'ALL' && splitList(form.audienceValues).length === 0) {
    problems['audience.values'] = t('Enter at least one value');
  }
  if (form.delivery === 'later' && !form.scheduledAt) problems.scheduledAt = t('Choose a date and time');
  if (form.type === 'CUSTOM') {
    try {
      customPayload = JSON.parse(form.customPayload);
      if (typeof customPayload !== 'object' || customPayload === null || Array.isArray(customPayload)) {
        problems.customPayload = t('Payload must be a JSON object');
      }
    } catch {
      problems.customPayload = t('Payload is not valid JSON');
    }
  }
  if (isNotification.value && styleField.value && !form.styleValue.trim()) {
    problems[`styleConfig.${styleField.value.key}`] = t('{field} is required', { field: t(styleField.value.label) });
  }

  errors.value = problems;
  if (Object.keys(problems).length > 0) return null;

  const field = styleField.value;
  return {
    type: form.type,
    ...(form.type !== 'CUSTOM' ? { body: form.body.trim() } : {}),
    ...(form.type !== 'CUSTOM' && form.title.trim() ? { title: form.title.trim() } : {}),
    ...(isNotification.value ? { style: form.style } : {}),
    ...(isNotification.value && field
      ? {
          styleConfig: {
            [field.key]:
              field.key === 'lines' ? form.styleValue.split('\n').filter((line) => line.trim()) : form.styleValue.trim(),
          },
        }
      : {}),
    ...(form.type === 'CUSTOM' ? { customPayload } : {}),
    platforms: form.platforms,
    audience:
      form.audienceType === 'ALL'
        ? { type: 'ALL' }
        : {
            type: form.audienceType,
            values: form.audienceType === 'REGISTRATION_IDS' ? form.selectedDevices : splitList(form.audienceValues),
          },
    strategy: form.strategy,
    ...(form.channel ? { channel: form.channel } : {}),
    // Sent without an offset, so the server reads it in the application's timezone.
    ...(form.delivery === 'later' ? { scheduledAt: form.scheduledAt } : {}),
  };
}

async function submit() {
  formError.value = null;
  const body = validate();
  if (!body) return;
  busy.value = true;
  try {
    const { data } = await api.post<Message>(`${workspace.envUrl}/messages`, body, {
      'Idempotency-Key': idempotencyKey,
    });
    idempotencyKey = crypto.randomUUID();
    if (data.scheduleType === 'SCHEDULED') {
      toast.success(t('Message scheduled'));
      await router.push('/scheduled');
    } else {
      toast.success(t('Message {status}', { status: valueLabel(data.status).toLowerCase() }));
      await router.push(`/messages/${data.msgid}`);
    }
  } catch (error) {
    if (error instanceof ApiRequestError) errors.value = error.fieldErrors;
    formError.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ t('New push') }}</h1>
      <p>{{ t('Sending from {app}, {environment} environment.', { app: workspace.app?.name ?? '', environment: environmentName(workspace.environment?.type) }) }}</p>
    </div>
  </div>

  <div class="notice info">{{ t('Phones registered through the Android app are reached through FCM. Other targets and channels are simulated, and are labelled as simulated.') }}</div>

  <form novalidate @submit.prevent="submit">
    <div v-if="formError" class="notice bad" role="alert">{{ formError }}</div>
    <div class="grid cols-2">
      <div class="card">
        <h2>{{ t('Content') }}</h2>
        <div class="field">
          <label for="type">{{ t('Message type') }}</label>
          <select id="type" v-model="form.type">
            <option value="NOTIFICATION">{{ t('Notification') }}</option>
            <option value="CUSTOM">{{ t('Custom (JSON payload)') }}</option>
            <option value="IN_APP">{{ t('In-app reminder') }}</option>
          </select>
        </div>

        <template v-if="form.type !== 'CUSTOM'">
          <div class="field">
            <label for="title">{{ isNotification ? t('Title') : t('Title (optional)') }}</label>
            <input id="title" v-model="form.title" maxlength="200" :class="{ invalid: errors.title }" />
            <span v-if="errors.title" class="error">{{ errors.title }}</span>
          </div>
          <div class="field">
            <label for="body">{{ t('Body') }}</label>
            <textarea id="body" v-model="form.body" maxlength="4000" :class="{ invalid: errors.body }"></textarea>
            <span v-if="errors.body" class="error">{{ errors.body }}</span>
          </div>
        </template>

        <div v-else class="field">
          <label for="payload">{{ t('JSON payload') }}</label>
          <textarea id="payload" v-model="form.customPayload" class="mono" rows="7" :class="{ invalid: errors.customPayload }"></textarea>
          <span v-if="errors.customPayload" class="error">{{ errors.customPayload }}</span>
        </div>

        <template v-if="isNotification">
          <div class="field">
            <label for="style">{{ t('Notification style') }}</label>
            <select id="style" v-model="form.style" @change="form.styleValue = ''">
              <option value="DEFAULT">{{ t('Default') }}</option>
              <option value="THUMBNAIL">{{ t('Thumbnail') }}</option>
              <option value="BIG_PICTURE">{{ t('Big picture') }}</option>
              <option value="TEXT">{{ t('Text') }}</option>
              <option value="INBOX">{{ t('Inbox') }}</option>
              <option value="CUSTOM">{{ t('Custom') }}</option>
            </select>
            <span class="help">{{ t('The Android app draws this style. Custom layouts fall back to plain text.') }}</span>
          </div>
          <div v-if="styleField" class="field">
            <label for="style-value">{{ t(styleField.label) }}</label>
            <textarea v-if="styleField.multiline" id="style-value" v-model="form.styleValue" :class="{ invalid: errors[`styleConfig.${styleField.key}`] }"></textarea>
            <input v-else id="style-value" v-model="form.styleValue" :class="{ invalid: errors[`styleConfig.${styleField.key}`] }" />
            <span class="help">{{ t(styleField.help) }}</span>
            <span v-if="errors[`styleConfig.${styleField.key}`]" class="error">{{ errors[`styleConfig.${styleField.key}`] }}</span>
          </div>
        </template>
      </div>

      <div class="card">
        <h2>{{ t('Audience and delivery') }}</h2>
        <div class="field">
          <span class="label">{{ t('Target platforms') }}</span>
          <div class="checks">
            <label><input v-model="form.platforms" type="checkbox" value="ANDROID" /> Android</label>
            <label><input v-model="form.platforms" type="checkbox" value="IOS" /> iOS</label>
            <label><input v-model="form.platforms" type="checkbox" value="HARMONYOS" /> HarmonyOS</label>
          </div>
          <span v-if="errors.platforms" class="error">{{ errors.platforms }}</span>
        </div>

        <div class="field">
          <label for="audience">{{ t('Audience') }}</label>
          <select id="audience" v-model="form.audienceType">
            <option value="ALL">{{ t('All devices') }}</option>
            <option value="REGISTRATION_IDS">{{ t('Selected devices') }}</option>
            <option value="TAGS">{{ t('Tags') }}</option>
            <option value="ALIASES">{{ t('Aliases') }}</option>
          </select>
        </div>
        <div v-if="form.audienceType === 'REGISTRATION_IDS'" class="field">
          <span class="label">{{ t('Target devices') }}</span>
          <div v-if="deviceChoices.length === 0" class="help">{{ t('No devices are registered in this environment.') }}</div>
          <div class="device-picker">
            <label v-for="device in deviceChoices" :key="device.id">
              <input v-model="form.selectedDevices" type="checkbox" :value="device.registrationId" />
              <span class="badge" :class="device.deliveryMode === 'REAL' ? 'good' : ''">{{ device.deliveryMode === 'REAL' ? t('Real') : t('Simulated') }}</span>
              <code>{{ device.registrationId }}</code>
              <span class="muted small">{{ device.model ?? device.vendor ?? device.platform }}</span>
            </label>
          </div>
          <span v-if="errors['audience.values']" class="error">{{ errors['audience.values'] }}</span>
        </div>
        <div v-else-if="form.audienceType !== 'ALL'" class="field">
          <label for="audience-values">{{ t('Values') }}</label>
          <textarea id="audience-values" v-model="form.audienceValues" :class="{ invalid: errors['audience.values'] }"></textarea>
          <span class="help">{{ t('Separate with commas or new lines.') }}</span>
          <span v-if="errors['audience.values']" class="error">{{ errors['audience.values'] }}</span>
        </div>

        <div class="field">
          <label for="strategy">{{ t('Delivery strategy') }}</label>
          <select id="strategy" v-model="form.strategy">
            <option v-for="item in STRATEGIES" :key="item.id" :value="item.id">{{ item.id }}: {{ t(item.label) }}</option>
          </select>
          <span class="help">{{ strategy ? t('{chain}. A channel is tried once.', { chain: t(strategy.chain) }) : '' }}</span>
        </div>

        <div class="field">
          <label for="channel">{{ t('Push channel') }}</label>
          <select id="channel" v-model="form.channel">
            <option value="">{{ t('Automatic, from the strategy') }}</option>
            <option v-for="id in CHANNEL_CHOICES" :key="id" :value="id">{{ t('{channel} only', { channel: channelLabel(id) }) }}</option>
          </select>
        </div>

        <div v-if="unreachablePhone" class="notice warn">
          {{ t('This plan has no FCM step, so a real phone will not receive it. Its target will be reported as failed. Use') }} <code>fcm_mtpush</code> {{ t('or') }} <code>mtpush_fcm</code> {{ t('to reach a phone.') }}
        </div>

        <div class="field">
          <span class="label">{{ t('Delivery time') }}</span>
          <div class="checks">
            <label><input v-model="form.delivery" type="radio" value="now" /> {{ t('Send now') }}</label>
            <label><input v-model="form.delivery" type="radio" value="later" /> {{ t('Schedule') }}</label>
          </div>
        </div>
        <div v-if="form.delivery === 'later'" class="field">
          <label for="scheduled-at">{{ t('Send at ({timezone})', { timezone: workspace.timezone }) }}</label>
          <input id="scheduled-at" v-model="form.scheduledAt" type="datetime-local" :class="{ invalid: errors.scheduledAt }" />
          <span class="help">{{ t('Read in the application\'s timezone, not your browser\'s.') }}</span>
          <span v-if="errors.scheduledAt" class="error">{{ errors.scheduledAt }}</span>
        </div>

        <button class="btn primary" type="submit" :disabled="busy">
          {{ busy ? t('Working…') : form.delivery === 'later' ? t('Schedule message') : t('Send push') }}
        </button>
      </div>
    </div>
  </form>
</template>
