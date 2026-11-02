<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { api } from '@/api/client';
import type { Analytics, Environment, Message, Overview } from '@/api/types';
import FunnelBars from '@/components/FunnelBars.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import TrendChart from '@/components/TrendChart.vue';
import { useResource } from '@/composables/useResource';
import { environmentName, formatDateTime, formatNumber, formatRate, messageTitle, relativeSeconds } from '@/lib/format';
import { t, translate } from '@/lib/i18n';
import { useHealthStore } from '@/stores/health';
import { useWorkspaceStore } from '@/stores/workspace';

const workspace = useWorkspaceStore();
const healthStore = useHealthStore();
const health = computed(() => healthStore.health);

const analytics = useResource(() => api.get<Analytics>(`${workspace.envUrl}/analytics`));
const overview = useResource(() => api.get<Overview>(`${workspace.envUrl}/analytics/overview`));
const recent = useResource(() => api.get<Message[]>(`${workspace.envUrl}/messages?pageSize=6`));
const environment = useResource(() => api.get<Environment>(workspace.envUrl));

onMounted(() => void healthStore.refresh());

const totals = computed(() => analytics.data.value?.totals ?? null);
const hasActivity = computed(() => (totals.value?.planned ?? 0) > 0);
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ t('Dashboard') }}</h1>
      <p>{{ t('{app}, {environment} environment. Last 30 days.', { app: workspace.app?.name ?? '', environment: environmentName(workspace.environment?.type) }) }}</p>
    </div>
    <div class="actions">
      <RouterLink class="btn" to="/analytics">{{ t('Full analytics') }}</RouterLink>
      <RouterLink class="btn primary" to="/push/new">{{ t('New push') }}</RouterLink>
    </div>
  </div>

  <StateBlock :loading="analytics.loading.value" :error="analytics.error.value" :has-data="!!totals" @retry="analytics.reload">
    <div v-if="totals" class="grid cols-4">
      <div class="card stat">
        <div class="label">{{ t('Messages sent') }}</div>
        <div class="value">{{ formatNumber(totals.messagesSent) }}</div>
        <div class="hint">{{ t('of {total} dispatched', { total: formatNumber(totals.messagesDispatched) }) }}</div>
      </div>
      <div class="card stat">
        <div class="label">{{ t('Delivered') }}</div>
        <div class="value">{{ formatNumber(totals.delivered) }}</div>
        <div class="hint">{{ t('{count} valid targets', { count: formatNumber(totals.valid) }) }}</div>
      </div>
      <div class="card stat">
        <div class="label">{{ t('Delivery rate') }}</div>
        <div class="value">{{ formatRate(totals.deliveryRate) }}</div>
        <div class="hint">{{ t('delivered / sent') }}</div>
      </div>
      <div class="card stat">
        <div class="label">{{ t('Click-through rate') }}</div>
        <div class="value">{{ formatRate(totals.clickThroughRate) }}</div>
        <div class="hint">{{ t('clicked / displayed') }}</div>
      </div>
    </div>

    <div v-if="hasActivity && analytics.data.value" class="grid cols-2" style="margin-top: 14px">
      <div class="card">
        <h2>{{ t('Daily activity') }}</h2>
        <TrendChart :points="analytics.data.value.trend" />
      </div>
      <div class="card">
        <h2>{{ t('Delivery funnel') }}</h2>
        <FunnelBars :summary="totals!" />
      </div>
    </div>
    <div v-else class="card" style="margin-top: 14px">
      <div class="state">
        <strong>{{ t('No messages in the last 30 days') }}</strong>
        {{ t('Send a push to see delivery activity here.') }}
      </div>
    </div>
  </StateBlock>

  <template v-if="overview.data.value">
    <div class="grid cols-2" style="margin-top: 14px">
      <div class="card">
        <h2>{{ t('Today, by hour') }}</h2>
        <TrendChart :points="overview.data.value.today" />
      </div>
      <div class="card">
        <h2>{{ t('Yesterday, by hour') }}</h2>
        <TrendChart :points="overview.data.value.yesterday" />
      </div>
    </div>
    <div class="grid cols-2" style="margin-top: 14px">
      <div class="card">
        <h2>{{ t('Yesterday\'s funnel') }}</h2>
        <FunnelBars :summary="overview.data.value.yesterdayFunnel" />
        <p class="muted small" style="margin-top: 10px">
          {{ t('Delivery rate {delivery}, click-through rate {clicks}', { delivery: formatRate(overview.data.value.yesterdayFunnel.deliveryRate), clicks: formatRate(overview.data.value.yesterdayFunnel.clickThroughRate) }) }}
        </p>
      </div>
      <div class="card stat">
        <div class="label">{{ t('Notification permission') }}</div>
        <div class="value">{{ formatRate(overview.data.value.notificationPermission.rate) }}</div>
        <div class="hint">
          {{ t('{enabled} of {known} devices that reported it', { enabled: formatNumber(overview.data.value.notificationPermission.enabled), known: formatNumber(overview.data.value.notificationPermission.known) }) }}
        </div>
      </div>
    </div>
  </template>

  <div class="grid cols-2" style="margin-top: 14px">
    <div class="card">
      <div class="card-head">
        <h2>{{ t('Recent messages') }}</h2>
        <RouterLink class="small" to="/messages">{{ t('View all') }}</RouterLink>
      </div>
      <StateBlock
        :loading="recent.loading.value"
        :error="recent.error.value"
        :has-data="!!recent.data.value"
        :empty="recent.data.value?.length === 0"
        :empty-title="t('No messages yet')"
        @retry="recent.reload"
      >
        <div class="table-wrap">
          <table>
            <tbody>
              <tr v-for="message in recent.data.value" :key="message.id">
                <td>
                  <RouterLink :to="`/messages/${message.msgid}`">{{ messageTitle(message) }}</RouterLink>
                  <div class="muted small">{{ formatDateTime(message.dispatchedAt ?? message.createdAt, workspace.timezone) }}</div>
                </td>
                <td class="num"><StatusBadge :status="message.status" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </StateBlock>
    </div>

    <div class="card">
      <h2>{{ t('System and usage') }}</h2>
      <dl class="facts">
        <dt>{{ t('Database') }}</dt>
        <dd><span class="badge" :class="health?.database === 'up' ? 'good' : 'bad'">{{ translate(health?.database ?? 'unknown') }}</span></dd>
        <dt>{{ t('Background worker') }}</dt>
        <dd>
          <span class="badge" :class="health?.worker === 'up' ? 'good' : 'warn'">{{ translate(health?.worker ?? 'unknown') }}</span>
          <span class="muted small"> {{ t('last seen {time}', { time: relativeSeconds(health?.workerLastSeenAt) }) }}</span>
        </dd>
        <dt>Firebase (FCM)</dt>
        <dd>
          <span class="badge" :class="health?.fcm.configured ? 'good' : 'warn'">{{ health?.fcm.configured ? t('configured') : t('not configured') }}</span>
          <span v-if="health?.fcm.projectId" class="muted small"> {{ health.fcm.projectId }}</span>
          <div v-if="health?.fcm.problem" class="error small">{{ health.fcm.problem }}</div>
        </dd>
        <template v-if="environment.data.value?.usage">
          <dt>{{ t('Devices') }}</dt>
          <dd>{{ formatNumber(environment.data.value.usage.devices) }}<span v-if="environment.data.value.limits" class="muted"> {{ t('of {max}', { max: formatNumber(environment.data.value.limits.maxDevices) }) }}</span></dd>
          <dt>{{ t('Tags') }}</dt>
          <dd>{{ environment.data.value.usage.tags }}<span v-if="environment.data.value.limits" class="muted"> {{ t('of {max}', { max: environment.data.value.limits.maxTags }) }}</span></dd>
          <dt>{{ t('Messages') }}</dt>
          <dd>{{ formatNumber(environment.data.value.usage.messages) }}</dd>
        </template>
        <dt>{{ t('Timezone') }}</dt>
        <dd>{{ workspace.timezone }}</dd>
      </dl>
    </div>
  </div>
</template>
