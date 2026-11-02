<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api, ApiRequestError, errorMessage, query } from '@/api/client';
import type { AuditEntry } from '@/api/types';
import PaginationBar from '@/components/PaginationBar.vue';
import StateBlock from '@/components/StateBlock.vue';
import { useResource } from '@/composables/useResource';
import { formatDateTime, roleLabel } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';
import { useHealthStore } from '@/stores/health';
import { useToastStore } from '@/stores/toast';

const auth = useAuthStore();
const health = useHealthStore();
const toast = useToastStore();

const passwords = reactive({ currentPassword: '', newPassword: '', confirm: '' });
const passwordError = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});
const busy = ref(false);

async function changePassword() {
  passwordError.value = null;
  fieldErrors.value = {};
  if (passwords.newPassword !== passwords.confirm) {
    fieldErrors.value = { confirm: t('The passwords do not match') };
    return;
  }
  busy.value = true;
  try {
    await api.post('/auth/change-password', {
      currentPassword: passwords.currentPassword,
      newPassword: passwords.newPassword,
    });
    Object.assign(passwords, { currentPassword: '', newPassword: '', confirm: '' });
    toast.success(t('Password changed'));
  } catch (error) {
    if (error instanceof ApiRequestError) fieldErrors.value = error.fieldErrors;
    passwordError.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}

const page = ref(1);
const audit = useResource(() => api.get<AuditEntry[]>(`/audit-logs${query({ page: page.value, pageSize: 15 })}`), [page]);
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ t('Settings') }}</h1>
      <p>{{ t('Your account and the audit trail.') }}</p>
    </div>
  </div>

  <div class="grid cols-2">
    <div class="card">
      <h2>{{ t('Profile') }}</h2>
      <dl class="facts">
        <dt>{{ t('Name') }}</dt>
        <dd>{{ auth.user?.name }}</dd>
        <dt>{{ t('Email') }}</dt>
        <dd>{{ auth.user?.email }}</dd>
        <dt>{{ t('Role') }}</dt>
        <dd>{{ auth.user ? roleLabel(auth.user.role) : '' }}</dd>
      </dl>
      <h2 style="margin-top: 18px">{{ t('Push delivery') }}</h2>
      <dl class="facts">
        <dt>Firebase</dt>
        <dd>
          <span class="badge" :class="health.fcmConfigured ? 'good' : 'warn'">{{ health.fcmConfigured ? t('Configured') : t('Not configured') }}</span>
        </dd>
        <template v-if="health.health?.fcm.projectId">
          <dt>{{ t('Project') }}</dt>
          <dd><code>{{ health.health.fcm.projectId }}</code></dd>
        </template>
        <dt>{{ t('Payload mode') }}</dt>
        <dd>{{ health.health?.fcm.payloadMode ?? '—' }}</dd>
      </dl>
      <div v-if="health.health?.fcm.problem" class="notice bad" role="alert" style="margin: 14px 0 0">{{ health.health.fcm.problem }}</div>
      <div class="notice info" style="margin: 14px 0 0">
        {{ t('FCM is the real provider. Other channels are simulators for devices registered in this console, and they never touch a real phone. Configure them per environment on each application\'s page.') }}
      </div>
    </div>

    <div class="card">
      <h2>{{ t('Change password') }}</h2>
      <form @submit.prevent="changePassword">
        <div v-if="passwordError" class="notice bad" role="alert">{{ passwordError }}</div>
        <div class="field">
          <label for="current">{{ t('Current password') }}</label>
          <input id="current" v-model="passwords.currentPassword" type="password" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label for="new">{{ t('New password') }}</label>
          <input id="new" v-model="passwords.newPassword" type="password" autocomplete="new-password" required :class="{ invalid: fieldErrors.newPassword }" />
          <span class="help">{{ t('At least 10 characters.') }}</span>
          <span v-if="fieldErrors.newPassword" class="error">{{ fieldErrors.newPassword }}</span>
        </div>
        <div class="field">
          <label for="confirm">{{ t('Confirm new password') }}</label>
          <input id="confirm" v-model="passwords.confirm" type="password" autocomplete="new-password" required :class="{ invalid: fieldErrors.confirm }" />
          <span v-if="fieldErrors.confirm" class="error">{{ fieldErrors.confirm }}</span>
        </div>
        <button class="btn primary" type="submit" :disabled="busy">{{ t('Change password') }}</button>
      </form>
    </div>
  </div>

  <div class="card">
    <h2>{{ t('Audit log') }}</h2>
    <StateBlock
      :loading="audit.loading.value"
      :error="audit.error.value"
      :has-data="!!audit.data.value"
      :empty="audit.data.value?.length === 0"
      :empty-title="t('No audit records')"
      @retry="audit.reload"
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('Time') }}</th>
              <th>{{ t('Actor') }}</th>
              <th>{{ t('Action') }}</th>
              <th>{{ t('Entity') }}</th>
              <th>{{ t('IP address') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in audit.data.value" :key="entry.id">
              <td class="nowrap">{{ formatDateTime(entry.createdAt) }}</td>
              <td>{{ entry.actorLabel }}</td>
              <td><code>{{ entry.action }}</code></td>
              <td>{{ entry.entityType }} {{ entry.entityId }}</td>
              <td>{{ entry.ipAddress ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar v-model="page" :meta="audit.meta.value" />
    </StateBlock>
  </div>
</template>
