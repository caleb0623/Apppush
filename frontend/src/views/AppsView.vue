<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiRequestError, errorMessage, query } from '@/api/client';
import type { AppDetail, AppSummary, Credentials } from '@/api/types';
import ModalDialog from '@/components/ModalDialog.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import SecretReveal from '@/components/SecretReveal.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { useResource } from '@/composables/useResource';
import { environmentName, formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useWorkspaceStore } from '@/stores/workspace';

const auth = useAuthStore();
const toast = useToastStore();
const workspace = useWorkspaceStore();
const router = useRouter();

const page = ref(1);
const search = ref('');
const status = ref('');
watch([search, status], () => {
  page.value = 1;
});

const list = useResource(
  () => api.get<AppSummary[]>(`/apps${query({ page: page.value, search: search.value, status: status.value })}`),
  [page, search, status],
);

const creating = ref(false);
const busy = ref(false);
const formError = ref<string | null>(null);
const errors = ref<Record<string, string>>({});
const secret = ref<Credentials | null>(null);
const createdId = ref<number | null>(null);
const form = reactive({ name: '', description: '', timezone: 'Asia/Shanghai', isVip: false, serviceValidUntil: '' });

function open() {
  Object.assign(form, { name: '', description: '', timezone: 'Asia/Shanghai', isVip: false, serviceValidUntil: '' });
  errors.value = {};
  formError.value = null;
  creating.value = true;
}

async function create() {
  busy.value = true;
  errors.value = {};
  formError.value = null;
  try {
    const { data } = await api.post<{ application: AppDetail; credentials: Credentials }>('/apps', {
      name: form.name,
      timezone: form.timezone,
      isVip: form.isVip,
      ...(form.description ? { description: form.description } : {}),
      ...(form.serviceValidUntil ? { serviceValidUntil: new Date(form.serviceValidUntil).toISOString() } : {}),
    });
    creating.value = false;
    secret.value = data.credentials;
    createdId.value = data.application.id;
    await list.reload();
  } catch (error) {
    if (error instanceof ApiRequestError) errors.value = error.fieldErrors;
    formError.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}

// Changing the workspace remounts this page, which would destroy the only copy of
// the secret, so the switch waits until it has been dismissed.
async function closeSecret() {
  secret.value = null;
  toast.success(t('Application created'));
  await workspace.refresh();
  if (createdId.value) {
    workspace.selectApp(createdId.value);
    void router.push(`/apps/${createdId.value}`);
  }
}
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ t('Applications') }}</h1>
      <p>{{ t('Each application has a production environment and an optional linked testing environment.') }}</p>
    </div>
    <button v-if="auth.isAdmin" class="btn primary" type="button" @click="open">{{ t('Create application') }}</button>
  </div>

  <div class="card">
    <div class="filters">
      <input v-model.lazy="search" type="search" :placeholder="t('Search by name')" :aria-label="t('Search by name')" />
      <select v-model="status" :aria-label="t('Status')">
        <option value="">{{ t('All statuses') }}</option>
        <option value="ACTIVE">{{ t('Active') }}</option>
        <option value="INACTIVE">{{ t('Inactive') }}</option>
      </select>
    </div>
    <StateBlock
      :loading="list.loading.value"
      :error="list.error.value"
      :has-data="!!list.data.value"
      :empty="list.data.value?.length === 0"
      :empty-title="t('No applications found')"
      :empty-text="t('Create one to get an AppKey and Master Secret.')"
      @retry="list.reload"
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('Name') }}</th>
              <th>{{ t('Status') }}</th>
              <th>{{ t('Environments') }}</th>
              <th>VIP</th>
              <th>{{ t('Service valid until') }}</th>
              <th>{{ t('Timezone') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="app in list.data.value" :key="app.id">
              <td>
                <RouterLink :to="`/apps/${app.id}`">{{ app.name }}</RouterLink>
                <div v-if="app.description" class="muted small">{{ app.description }}</div>
              </td>
              <td><StatusBadge :status="app.status" /></td>
              <td><span v-for="env in app.environments" :key="env.id" class="tag">{{ environmentName(env.type) }}</span></td>
              <td>{{ app.isVip ? t('Yes') : t('No') }}</td>
              <td class="nowrap">{{ app.serviceValidUntil ? formatDateTime(app.serviceValidUntil, app.timezone) : t('No expiry') }}</td>
              <td>{{ app.timezone }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar v-model="page" :meta="list.meta.value" />
    </StateBlock>
  </div>

  <ModalDialog v-if="creating" :title="t('Create application')" @close="creating = false">
    <form @submit.prevent="create">
      <div v-if="formError" class="notice bad" role="alert">{{ formError }}</div>
      <div class="field">
        <label for="app-name">{{ t('Name') }}</label>
        <input id="app-name" v-model="form.name" required maxlength="100" :class="{ invalid: errors.name }" />
        <span v-if="errors.name" class="error">{{ errors.name }}</span>
      </div>
      <div class="field">
        <label for="app-description">{{ t('Description') }}</label>
        <input id="app-description" v-model="form.description" maxlength="500" />
      </div>
      <div class="field">
        <label for="app-timezone">{{ t('Timezone') }}</label>
        <input id="app-timezone" v-model="form.timezone" required :class="{ invalid: errors.timezone }" />
        <span class="help">{{ t('IANA name. Schedules and analytics use this timezone.') }}</span>
        <span v-if="errors.timezone" class="error">{{ errors.timezone }}</span>
      </div>
      <div class="field">
        <label for="app-valid">{{ t('Service valid until') }}</label>
        <input id="app-valid" v-model="form.serviceValidUntil" type="datetime-local" />
      </div>
      <div class="checks field"><label><input v-model="form.isVip" type="checkbox" /> {{ t('VIP application') }}</label></div>
      <div class="modal-foot">
        <button class="btn" type="button" @click="creating = false">{{ t('Cancel') }}</button>
        <button class="btn primary" type="submit" :disabled="busy">{{ busy ? t('Creating…') : t('Create') }}</button>
      </div>
    </form>
  </ModalDialog>

  <SecretReveal v-if="secret" :credentials="secret" @close="closeSecret" />
</template>
