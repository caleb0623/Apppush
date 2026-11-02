<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, query } from '@/api/client';
import type { ScheduledJob } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { useResource } from '@/composables/useResource';
import { formatDateTime, messageTitle, relativeSeconds, valueLabel } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useWorkspaceStore } from '@/stores/workspace';

const POLL_MS = 3000;
const WORKER_ONLINE_MS = 15_000;

const auth = useAuthStore();
const toast = useToastStore();
const workspace = useWorkspaceStore();

const page = ref(1);
const status = ref('');
watch(status, () => {
  page.value = 1;
});

const jobs = useResource(
  () => api.get<ScheduledJob[]>(`${workspace.envUrl}/schedules${query({ page: page.value, status: status.value })}`),
  [page, status],
);

const lastSeen = computed(() => (jobs.meta.value?.workerLastSeenAt as string | null | undefined) ?? null);
const workerOnline = computed(
  () => !!lastSeen.value && Date.now() - new Date(lastSeen.value).getTime() < WORKER_ONLINE_MS,
);

const cancelling = ref<ScheduledJob | null>(null);
const busy = ref(false);

async function cancel() {
  if (!cancelling.value) return;
  busy.value = true;
  try {
    await api.post(`${workspace.envUrl}/schedules/${cancelling.value.id}/cancel`);
    toast.success(t('Scheduled message cancelled'));
    cancelling.value = null;
    await jobs.reload();
  } catch (error) {
    toast.error(error);
    cancelling.value = null;
    await jobs.reload();
  } finally {
    busy.value = false;
  }
}

// Refreshing while the page is open shows jobs moving through their states.
const timer = setInterval(() => void jobs.reload(true), POLL_MS);
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ t('Scheduled messages') }}</h1>
      <p>{{ t('Times are shown in {timezone}. This page refreshes itself.', { timezone: workspace.timezone }) }}</p>
    </div>
    <div class="actions">
      <span class="badge" :class="workerOnline ? 'good' : 'warn'">{{ workerOnline ? t('Worker online') : t('Worker offline') }}</span>
      <span class="muted small">{{ t('last seen {time}', { time: relativeSeconds(lastSeen) }) }}</span>
      <RouterLink class="btn primary" to="/push/new">{{ t('Schedule a push') }}</RouterLink>
    </div>
  </div>

  <div v-if="!workerOnline && jobs.data.value" class="notice warn">
    {{ t('The background worker is not running, so due messages will wait. Start it with:') }} <code>npm run dev:worker</code>
  </div>

  <div class="card">
    <div class="filters">
      <select v-model="status" :aria-label="t('Status')">
        <option value="">{{ t('All statuses') }}</option>
        <option v-for="value in ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']" :key="value" :value="value">
          {{ valueLabel(value) }}
        </option>
      </select>
    </div>

    <StateBlock
      :loading="jobs.loading.value"
      :error="jobs.error.value"
      :has-data="!!jobs.data.value"
      :empty="jobs.data.value?.length === 0"
      :empty-title="t('No scheduled messages')"
      :empty-text="t('Choose Schedule on the New push page.')"
      @retry="jobs.reload"
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('Message') }}</th>
              <th>{{ t('Run at') }}</th>
              <th>{{ t('Status') }}</th>
              <th>{{ t('Strategy') }}</th>
              <th class="num">{{ t('Attempts') }}</th>
              <th>{{ t('Last error') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="job in jobs.data.value" :key="job.id">
              <td>
                <RouterLink :to="`/messages/${job.message.msgid}`">{{ messageTitle(job.message) }}</RouterLink>
                <div><code class="muted">{{ job.message.msgid }}</code></div>
              </td>
              <td class="nowrap">{{ formatDateTime(job.runAt, workspace.timezone) }}</td>
              <td><StatusBadge :status="job.status" /></td>
              <td><code>{{ job.message.strategy }}</code></td>
              <td class="num">{{ job.attempts }} / {{ job.maxAttempts }}</td>
              <td class="small">{{ job.lastError ?? '—' }}</td>
              <td class="num">
                <button v-if="auth.isAdmin && job.status === 'PENDING'" class="btn small danger" type="button" @click="cancelling = job">{{ t('Cancel') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar v-model="page" :meta="jobs.meta.value" />
    </StateBlock>
  </div>

  <ConfirmDialog
    v-if="cancelling"
    :title="t('Cancel scheduled message')"
    :text="t('Cancel “{name}”? It will not be sent.', { name: cancelling.message.title ?? cancelling.message.msgid })"
    :confirm-label="t('Cancel message')"
    :busy="busy"
    @confirm="cancel"
    @cancel="cancelling = null"
  />
</template>
