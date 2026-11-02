<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api, ApiRequestError, errorMessage } from '@/api/client';
import type { AppDetail, Credentials, Environment, SimulatorSettings } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import SecretReveal from '@/components/SecretReveal.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { useResource } from '@/composables/useResource';
import { CHANNEL_LABELS, channelLabel, environmentName, formatDateTime, splitList } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useWorkspaceStore } from '@/stores/workspace';

const props = defineProps<{ id: string }>();

const auth = useAuthStore();
const toast = useToastStore();
const workspace = useWorkspaceStore();

const channels = Object.keys(CHANNEL_LABELS).filter((id) => id !== 'pns');

const app = useResource(() => api.get<AppDetail>(`/apps/${props.id}`));

const meta = reactive({ name: '', description: '', iconUrl: '', timezone: '', isVip: false, serviceValidUntil: '' });
const metaErrors = ref<Record<string, string>>({});
const savingMeta = ref(false);

const selectedType = ref<Environment['type']>('PRODUCTION');
const env = computed(() => app.data.value?.environments.find((e) => e.type === selectedType.value) ?? null);
const testing = computed(() => app.data.value?.environments.find((e) => e.type === 'TESTING') ?? null);

const config = reactive({
  callbackUrl: '',
  callbackEnabled: false,
  ipAllowlist: '',
  enabledChannels: [] as string[],
  simulator: {} as Record<string, { mode: SimulatorSettings['mode']; failureReason: string; failureRate: string }>,
});
const configErrors = ref<Record<string, string>>({});
const savingConfig = ref(false);

const secret = ref<Credentials | null>(null);
const confirm = ref<'rotate' | 'deactivate' | null>(null);
const busy = ref(false);

watch(app.data, (value) => {
  if (!value) return;
  Object.assign(meta, {
    name: value.name,
    description: value.description ?? '',
    iconUrl: value.iconUrl ?? '',
    timezone: value.timezone,
    isVip: value.isVip,
    serviceValidUntil: value.serviceValidUntil?.slice(0, 16) ?? '',
  });
});

watch(env, (value) => {
  if (!value) return;
  config.callbackUrl = value.callbackUrl ?? '';
  config.callbackEnabled = value.callbackEnabled;
  config.ipAllowlist = value.ipAllowlist.join('\n');
  config.enabledChannels = [...value.enabledChannels];
  config.simulator = Object.fromEntries(
    channels.map((id) => {
      const settings = value.simulatorConfig[id];
      return [
        id,
        {
          mode: settings?.mode ?? 'success',
          failureReason: settings?.failureReason ?? '',
          failureRate: settings?.failureRate === undefined ? '' : String(settings.failureRate),
        },
      ];
    }),
  );
});

async function saveMeta() {
  savingMeta.value = true;
  metaErrors.value = {};
  try {
    await api.patch(`/apps/${props.id}`, {
      name: meta.name,
      description: meta.description || null,
      iconUrl: meta.iconUrl || null,
      timezone: meta.timezone,
      isVip: meta.isVip,
      // The field is labelled and filled as UTC, so it must not be read as browser-local.
      serviceValidUntil: meta.serviceValidUntil ? new Date(`${meta.serviceValidUntil}:00Z`).toISOString() : null,
    });
    toast.success(t('Application updated in every environment'));
    await Promise.all([app.reload(), workspace.refresh()]);
  } catch (error) {
    if (error instanceof ApiRequestError) metaErrors.value = error.fieldErrors;
    toast.error(error);
  } finally {
    savingMeta.value = false;
  }
}

function simulatorPayload() {
  const result: Record<string, SimulatorSettings> = {};
  for (const [id, value] of Object.entries(config.simulator)) {
    if (value.mode === 'success' && !value.failureRate) continue;
    result[id] = {
      mode: value.mode,
      ...(value.failureReason ? { failureReason: value.failureReason } : {}),
      ...(value.failureRate ? { failureRate: Number(value.failureRate) } : {}),
    };
  }
  return result;
}

async function saveConfig() {
  if (!env.value) return;
  savingConfig.value = true;
  configErrors.value = {};
  try {
    await api.patch(`/environments/${env.value.id}/config`, {
      callbackUrl: config.callbackUrl || null,
      callbackEnabled: config.callbackEnabled,
      ipAllowlist: splitList(config.ipAllowlist),
      enabledChannels: config.enabledChannels,
      simulatorConfig: simulatorPayload(),
    });
    toast.success(t('Saved for the {environment} environment only', { environment: environmentName(selectedType.value) }));
    await app.reload();
  } catch (error) {
    if (error instanceof ApiRequestError) configErrors.value = error.fieldErrors;
    toast.error(error);
  } finally {
    savingConfig.value = false;
  }
}

async function rotate() {
  if (!env.value) return;
  busy.value = true;
  try {
    secret.value = (await api.post<Credentials>(`/environments/${env.value.id}/credentials/rotate`)).data;
    confirm.value = null;
    await app.reload();
  } catch (error) {
    toast.error(error);
  } finally {
    busy.value = false;
  }
}

async function enableTesting() {
  busy.value = true;
  try {
    const { data } = await api.post<{ credentials: Credentials }>(`/apps/${props.id}/testing-environment`);
    secret.value = data.credentials;
    await app.reload();
    selectedType.value = 'TESTING';
  } catch (error) {
    toast.error(errorMessage(error));
  } finally {
    busy.value = false;
  }
}

// Waits for the secret to be dismissed: a workspace change can remount this page and lose it.
async function closeSecret() {
  secret.value = null;
  await workspace.refresh();
}

async function toggleStatus() {
  const action = app.data.value?.status === 'ACTIVE' ? 'deactivate' : 'activate';
  busy.value = true;
  try {
    await api.post(`/apps/${props.id}/${action}`);
    confirm.value = null;
    toast.success(action === 'activate' ? t('Application activated') : t('Application deactivated'));
    await Promise.all([app.reload(), workspace.refresh()]);
  } catch (error) {
    toast.error(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <StateBlock :loading="app.loading.value" :error="app.error.value" :has-data="!!app.data.value" @retry="app.reload">
    <template v-if="app.data.value">
      <div class="page-header">
        <div>
          <h1>{{ app.data.value.name }}</h1>
          <p><StatusBadge :status="app.data.value.status" /> <RouterLink to="/apps" class="small">{{ t('All applications') }}</RouterLink></p>
        </div>
        <div v-if="auth.isAdmin" class="actions">
          <button v-if="!testing" class="btn" type="button" :disabled="busy || app.data.value.status !== 'ACTIVE'" @click="enableTesting">{{ t('Enable testing environment') }}</button>
          <button v-if="app.data.value.status === 'ACTIVE'" class="btn danger" type="button" @click="confirm = 'deactivate'">{{ t('Deactivate') }}</button>
          <button v-else class="btn" type="button" :disabled="busy" @click="toggleStatus">{{ t('Reactivate') }}</button>
        </div>
      </div>

      <div class="card">
        <h2>{{ t('Shared metadata') }}</h2>
        <p class="muted small" style="margin: -8px 0 12px">{{ t('Stored once and used by every environment of this application.') }}</p>
        <form @submit.prevent="saveMeta">
          <div class="grid cols-2" style="gap: 0 14px">
            <div class="field">
              <label for="meta-name">{{ t('Name') }}</label>
              <input id="meta-name" v-model="meta.name" required :class="{ invalid: metaErrors.name }" />
              <span v-if="metaErrors.name" class="error">{{ metaErrors.name }}</span>
            </div>
            <div class="field">
              <label for="meta-icon">{{ t('Icon URL') }}</label>
              <input id="meta-icon" v-model="meta.iconUrl" :class="{ invalid: metaErrors.iconUrl }" />
              <span v-if="metaErrors.iconUrl" class="error">{{ metaErrors.iconUrl }}</span>
            </div>
            <div class="field">
              <label for="meta-timezone">{{ t('Timezone') }}</label>
              <input id="meta-timezone" v-model="meta.timezone" required :class="{ invalid: metaErrors.timezone }" />
              <span v-if="metaErrors.timezone" class="error">{{ metaErrors.timezone }}</span>
            </div>
            <div class="field">
              <label for="meta-valid">{{ t('Service valid until (UTC)') }}</label>
              <input id="meta-valid" v-model="meta.serviceValidUntil" type="datetime-local" />
            </div>
            <div class="field">
              <label for="meta-description">{{ t('Description') }}</label>
              <input id="meta-description" v-model="meta.description" />
            </div>
            <div class="field checks" style="align-self: end"><label><input v-model="meta.isVip" type="checkbox" /> {{ t('VIP application') }}</label></div>
          </div>
          <button v-if="auth.isAdmin" class="btn primary" type="submit" :disabled="savingMeta || app.data.value.status !== 'ACTIVE'">{{ t('Save metadata') }}</button>
        </form>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>{{ t('Environment configuration') }}</h2>
          <div class="env-switch" role="group" :aria-label="t('Environment to configure')">
            <button type="button" :class="{ on: selectedType === 'PRODUCTION' }" @click="selectedType = 'PRODUCTION'">{{ t('Production') }}</button>
            <button type="button" :class="{ on: selectedType === 'TESTING' }" :disabled="!testing" @click="selectedType = 'TESTING'">{{ t('Testing') }}</button>
          </div>
        </div>

        <template v-if="env">
          <div v-if="env.limits" class="notice info">
            {{ t('Limits: {maxDevices} devices, {maxTags} tags, {maxDevicesPerTag} devices per tag, {maxTagsPerDevice} tags per device, {maxRequestsPerSecond} requests per second.', { ...env.limits }) }}
          </div>

          <h3 style="margin-bottom: 8px">{{ t('Credentials') }}</h3>
          <dl class="facts" style="margin-bottom: 12px">
            <dt>AppKey</dt>
            <dd><code>{{ env.appKey }}</code></dd>
            <dt>Master Secret</dt>
            <dd>
              <code>{{ env.credential?.hint ?? t('none') }}</code>
              <span class="muted small"> {{ t('issued {date}. Stored as a hash, so it cannot be shown again.', { date: formatDateTime(env.credential?.createdAt) }) }}</span>
            </dd>
          </dl>
          <button v-if="auth.isAdmin" class="btn" type="button" @click="confirm = 'rotate'">{{ t('Rotate Master Secret') }}</button>

          <form style="margin-top: 20px" @submit.prevent="saveConfig">
            <h3 style="margin-bottom: 8px">{{ t('Callback and security') }}</h3>
            <div class="notice warn">{{ t('Callback settings are stored per environment. This local build does not send outbound callbacks.') }}</div>
            <div class="grid cols-2" style="gap: 0 14px">
              <div class="field">
                <label for="cfg-callback">{{ t('Callback URL') }}</label>
                <input id="cfg-callback" v-model="config.callbackUrl" :class="{ invalid: configErrors.callbackUrl }" />
                <span v-if="configErrors.callbackUrl" class="error">{{ configErrors.callbackUrl }}</span>
                <span class="checks"><label><input v-model="config.callbackEnabled" type="checkbox" /> {{ t('Callback enabled') }}</label></span>
              </div>
              <div class="field">
                <label for="cfg-ips">{{ t('API client IP allowlist') }}</label>
                <textarea id="cfg-ips" v-model="config.ipAllowlist" rows="3" :class="{ invalid: configErrors.ipAllowlist }"></textarea>
                <span class="help">{{ t('One per line. Leave empty to allow any IP. Applies to AppKey clients, not the console.') }}</span>
              </div>
            </div>

            <h3 style="margin: 8px 0">{{ t('Integration channels') }}</h3>
            <div class="checks field">
              <label v-for="channel in channels" :key="channel">
                <input v-model="config.enabledChannels" type="checkbox" :value="channel" /> {{ channelLabel(channel) }}
              </label>
            </div>

            <h3 style="margin: 8px 0">{{ t('Channel simulator') }}</h3>
            <p class="muted small" style="margin-bottom: 8px">{{ t('Controls simulated outcomes, so that fallback can be demonstrated. Results are repeatable. Failure rate is a share from 0 to 1.') }}</p>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{{ t('Channel') }}</th>
                    <th>{{ t('Outcome') }}</th>
                    <th>{{ t('Failure reason') }}</th>
                    <th>{{ t('Failure rate') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="channel in channels" :key="channel">
                    <td class="nowrap">{{ channelLabel(channel) }}</td>
                    <template v-if="config.simulator[channel]">
                      <td>
                        <select v-model="config.simulator[channel].mode" :aria-label="t('{channel} outcome', { channel: channelLabel(channel) })">
                          <option value="success">{{ t('Succeed') }}</option>
                          <option value="accept_only">{{ t('Accept, no receipt') }}</option>
                          <option value="fail">{{ t('Fail') }}</option>
                        </select>
                      </td>
                      <td><input v-model="config.simulator[channel].failureReason" :aria-label="t('{channel} failure reason', { channel: channelLabel(channel) })" :placeholder="t('Default')" /></td>
                      <td><input v-model="config.simulator[channel].failureRate" :aria-label="t('{channel} failure rate', { channel: channelLabel(channel) })" type="number" min="0" max="1" step="0.01" placeholder="0" /></td>
                    </template>
                  </tr>
                </tbody>
              </table>
            </div>
            <button v-if="auth.isAdmin" class="btn primary" type="submit" style="margin-top: 12px" :disabled="savingConfig || app.data.value.status !== 'ACTIVE'">
              {{ t('Save {environment} configuration', { environment: environmentName(selectedType) }) }}
            </button>
          </form>
        </template>
      </div>
    </template>
  </StateBlock>

  <ConfirmDialog
    v-if="confirm === 'rotate'"
    :title="t('Rotate Master Secret')"
    :text="t('The current secret stops working immediately. Clients must switch to the new one.')"
    :confirm-label="t('Rotate')"
    :busy="busy"
    @confirm="rotate"
    @cancel="confirm = null"
  />
  <ConfirmDialog
    v-if="confirm === 'deactivate'"
    :title="t('Deactivate application')"
    :text="t('API clients and sends are rejected, in every environment, until it is reactivated. Pending scheduled messages will fail.')"
    :confirm-label="t('Deactivate')"
    :busy="busy"
    @confirm="toggleStatus"
    @cancel="confirm = null"
  />
  <SecretReveal v-if="secret" :credentials="secret" @close="closeSecret" />
</template>
