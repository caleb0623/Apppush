<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, query } from '@/api/client';
import type { Message, MessageAnalytics, Target } from '@/api/types';
import BreakdownTable from '@/components/BreakdownTable.vue';
import FunnelBars from '@/components/FunnelBars.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { useResource } from '@/composables/useResource';
import { audienceLabel, channelLabel, eventLabel, failureStage, formatDateTime, formatNumber, formatRate, messageTitle, valueLabel } from '@/lib/format';
import { t, translate } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useWorkspaceStore } from '@/stores/workspace';

const props = defineProps<{ msgid: string }>();

const auth = useAuthStore();
const toast = useToastStore();
const workspace = useWorkspaceStore();

const base = computed(() => `${workspace.envUrl}/messages/${props.msgid}`);
const targetPage = ref(1);
const busy = ref(false);

const message = useResource(() => api.get<Message>(base.value));
const analytics = useResource(() =>
  api.get<MessageAnalytics>(`${workspace.envUrl}/analytics/messages/${props.msgid}`),
);
const targets = useResource(
  () => api.get<Target[]>(`${base.value}/targets${query({ page: targetPage.value, pageSize: 25 })}`),
  [targetPage],
);

const canSimulate = computed(
  () => auth.isAdmin && message.data.value?.dispatchedAt && (message.data.value.delivery?.simulated ?? 0) > 0,
);
const hasRealTargets = computed(() => (message.data.value?.delivery?.real ?? 0) > 0);
const pendingReceipts = computed(() => {
  const funnel = message.data.value?.funnel;
  return funnel ? funnel.sent - funnel.delivered : 0;
});

async function record(type: 'DELIVERED' | 'DISPLAYED' | 'CLICKED') {
  busy.value = true;
  try {
    const { data } = await api.post<{ recorded: number }>(`${base.value}/events`, { type });
    const stage = translate(type.toLowerCase());
    toast.success(
      data.recorded === 1
        ? t('Recorded 1 simulated {stage} event', { stage })
        : t('Recorded {count} simulated {stage} events', { count: data.recorded, stage }),
    );
    await Promise.all([message.reload(), analytics.reload(), targets.reload()]);
  } catch (error) {
    toast.error(error);
  } finally {
    busy.value = false;
  }
}

/** A phone reports after the send finishes, so real messages stay live for a while. */
const RECEIPT_WINDOW_MS = 5 * 60_000;

const awaitingPhone = (value: Message) =>
  (value.delivery?.real ?? 0) > 0 &&
  value.completedAt !== null &&
  Date.now() - Date.parse(value.completedAt) < RECEIPT_WINDOW_MS;

// A message moves on while its job runs, so keep polling until it settles.
let timer: ReturnType<typeof setTimeout> | undefined;
watch(message.data, (value) => {
  clearTimeout(timer);
  if (value?.status === 'PENDING' || value?.status === 'PROCESSING' || (value && awaitingPhone(value))) {
    timer = setTimeout(
      () => void Promise.all([message.reload(true), targets.reload(true), analytics.reload(true)]),
      3000,
    );
  }
});
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <StateBlock :loading="message.loading.value" :error="message.error.value" :has-data="!!message.data.value" @retry="message.reload">
    <template v-if="message.data.value">
      <div class="page-header">
        <div>
          <h1>{{ messageTitle(message.data.value) }}</h1>
          <p>msgid <code>{{ message.data.value.msgid }}</code> <StatusBadge :status="message.data.value.status" /></p>
        </div>
        <RouterLink class="btn" to="/messages">{{ t('All messages') }}</RouterLink>
      </div>

      <div v-if="message.data.value.simulationNotice" class="notice warn">{{ translate(message.data.value.simulationNotice) }}</div>
      <div v-if="hasRealTargets" class="notice info">
        {{ t('Sent means Google accepted the message. Delivered, displayed and clicked appear only when the phone reports them, and this page updates as they arrive.') }}
      </div>
      <div v-if="message.data.value.failureReason" class="notice bad">{{ t('Failure: {reason}', { reason: message.data.value.failureReason }) }}</div>

      <div class="grid cols-2">
        <div class="card">
          <h2>{{ t('Details') }}</h2>
          <dl class="facts">
            <dt>{{ t('Type') }}</dt>
            <dd>{{ valueLabel(message.data.value.type) }}</dd>
            <dt>{{ t('Style') }}</dt>
            <dd>{{ valueLabel(message.data.value.style) }}</dd>
            <dt>{{ t('Strategy') }}</dt>
            <dd><code>{{ message.data.value.strategy }}</code></dd>
            <template v-if="message.data.value.channelOverride">
              <dt>{{ t('Channel') }}</dt>
              <dd>{{ t('{channel} only', { channel: channelLabel(message.data.value.channelOverride) }) }}</dd>
            </template>
            <dt>{{ t('Platforms') }}</dt>
            <dd>{{ message.data.value.platforms.join(', ') }}</dd>
            <dt>{{ t('Audience') }}</dt>
            <dd>{{ audienceLabel(message.data.value.audienceType) }}<span v-if="message.data.value.audience.length">: {{ message.data.value.audience.join(', ') }}</span></dd>
            <dt>{{ t('Delivery') }}</dt>
            <dd>{{ valueLabel(message.data.value.scheduleType) }}</dd>
            <template v-if="message.data.value.scheduledAt">
              <dt>{{ t('Scheduled for') }}</dt>
              <dd>{{ formatDateTime(message.data.value.scheduledAt, workspace.timezone) }}</dd>
            </template>
            <dt>{{ t('Dispatched') }}</dt>
            <dd>{{ formatDateTime(message.data.value.dispatchedAt, workspace.timezone) }}</dd>
            <template v-if="message.data.value.body">
              <dt>{{ t('Body') }}</dt>
              <dd>{{ message.data.value.body }}</dd>
            </template>
          </dl>
          <template v-if="message.data.value.customPayload">
            <h3 style="margin: 12px 0 6px">{{ t('Custom payload') }}</h3>
            <pre class="json">{{ JSON.stringify(message.data.value.customPayload, null, 2) }}</pre>
          </template>
          <template v-if="message.data.value.styleConfig">
            <h3 style="margin: 12px 0 6px">{{ t('Style configuration') }}</h3>
            <pre class="json">{{ JSON.stringify(message.data.value.styleConfig, null, 2) }}</pre>
          </template>
        </div>

        <div class="card">
          <h2>{{ t('Delivery funnel') }}</h2>
          <template v-if="message.data.value.funnel">
            <FunnelBars :summary="message.data.value.funnel" />
            <dl class="facts" style="margin-top: 14px">
              <dt>{{ t('Delivery rate') }}</dt>
              <dd>{{ formatRate(message.data.value.funnel.deliveryRate) }} <span class="muted small">{{ t('delivered / sent') }}</span></dd>
              <dt>{{ t('Display rate') }}</dt>
              <dd>{{ formatRate(message.data.value.funnel.displayRate) }} <span class="muted small">{{ t('displayed / delivered') }}</span></dd>
              <dt>{{ t('Click-through rate') }}</dt>
              <dd>{{ formatRate(message.data.value.funnel.clickThroughRate) }} <span class="muted small">{{ t('clicked / displayed') }}</span></dd>
            </dl>
          </template>
          <div v-if="canSimulate" style="margin-top: 16px">
            <h3 style="margin-bottom: 4px">{{ t('Simulate device reports') }}</h3>
            <p class="muted small" style="margin-bottom: 8px">{{ t('These record simulated events on simulated targets only. No device produced them.') }}</p>
            <div class="actions">
              <button class="btn small" type="button" :disabled="busy || pendingReceipts === 0" @click="record('DELIVERED')">{{ t('Confirm delivery') }}</button>
              <button class="btn small" type="button" :disabled="busy" @click="record('DISPLAYED')">{{ t('Record display') }}</button>
              <button class="btn small" type="button" :disabled="busy" @click="record('CLICKED')">{{ t('Record click') }}</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 14px">
        <h2>{{ t('Targets and delivery attempts') }}</h2>
        <StateBlock
          :loading="targets.loading.value"
          :error="targets.error.value"
          :has-data="!!targets.data.value"
          :empty="targets.data.value?.length === 0"
          :empty-title="t('No targets yet')"
          :empty-text="t('Targets are resolved when the message is dispatched.')"
          @retry="targets.reload"
        >
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ t('Registration ID') }}</th>
                  <th>{{ t('Mode') }}</th>
                  <th>{{ t('Platform') }}</th>
                  <th>{{ t('Version') }}</th>
                  <th>{{ t('Status') }}</th>
                  <th>{{ t('Attempts, in order') }}</th>
                  <th>{{ t('Final channel') }}</th>
                  <th>{{ t('Reason') }}</th>
                  <th>{{ t('Events') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="target in targets.data.value" :key="target.id">
                  <td><code>{{ target.registrationId }}</code></td>
                  <td><span class="badge" :class="target.deliveryMode === 'REAL' ? 'good' : ''">{{ target.deliveryMode === 'REAL' ? t('Real') : t('Simulated') }}</span></td>
                  <td>{{ target.platform ?? '—' }}</td>
                  <td>{{ target.appVersion ?? '—' }}</td>
                  <td><StatusBadge :status="target.status" /></td>
                  <td>
                    <div class="attempt-chain">
                      <span v-for="attempt in target.attempts" :key="attempt.id" :title="t('{provider} at {time}', { provider: attempt.provider, time: formatDateTime(attempt.attemptedAt, workspace.timezone) })">
                        <span class="tag">{{ attempt.isFallback ? t('fallback: {channel}', { channel: channelLabel(attempt.channel) }) : channelLabel(attempt.channel) }}</span>
                        <StatusBadge :status="attempt.outcome" />
                      </span>
                      <span v-if="target.attempts.length === 0" class="muted">{{ t('None') }}</span>
                    </div>
                    <template v-for="attempt in target.attempts" :key="attempt.id">
                      <details v-if="attempt.providerResponse" class="small">
                        <summary>{{ t('{channel} response', { channel: channelLabel(attempt.channel) }) }}</summary>
                        <pre class="json">{{ JSON.stringify(attempt.providerResponse, null, 2) }}</pre>
                      </details>
                    </template>
                  </td>
                  <td>{{ channelLabel(target.finalChannel) }}</td>
                  <td class="small">{{ target.invalidReason ?? target.failureReason ?? '—' }}</td>
                  <td class="small">
                    <div v-for="event in target.events" :key="event.type" :title="formatDateTime(event.occurredAt, workspace.timezone)">{{ eventLabel(event) }}</div>
                    <span v-if="target.events.length === 0">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <PaginationBar v-model="targetPage" :meta="targets.meta.value" />
        </StateBlock>
      </div>

      <template v-if="analytics.data.value && analytics.data.value.totals.planned > 0">
        <div class="grid cols-2" style="margin-top: 14px">
          <BreakdownTable :title="t('By channel')" :groups="analytics.data.value.byChannel" channels loss />
          <BreakdownTable :title="t('By platform')" :groups="analytics.data.value.byPlatform" loss />
        </div>
        <div v-if="analytics.data.value.failureReasons.length > 0" class="card" style="margin-top: 14px">
          <h2>{{ t('Failure reasons') }}</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ t('Stage') }}</th>
                  <th>{{ t('Reason') }}</th>
                  <th class="num">{{ t('Targets') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in analytics.data.value.failureReasons" :key="`${row.stage}:${row.reason}`">
                  <td class="small">{{ failureStage(row.stage) }}</td>
                  <td><code>{{ row.reason }}</code></td>
                  <td class="num">{{ formatNumber(row.count) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>
  </StateBlock>
</template>
