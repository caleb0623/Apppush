<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, query } from '@/api/client';
import type { Analytics, UserAnalytics } from '@/api/types';
import BreakdownTable from '@/components/BreakdownTable.vue';
import FunnelBars from '@/components/FunnelBars.vue';
import StateBlock from '@/components/StateBlock.vue';
import TrendChart from '@/components/TrendChart.vue';
import { useResource } from '@/composables/useResource';
import { CHANNEL_CHOICES, channelLabel, failureStage, formatNumber, formatRate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useWorkspaceStore } from '@/stores/workspace';

const workspace = useWorkspaceStore();
const router = useRouter();

const from = ref('');
const to = ref('');
const granularity = ref<'day' | 'month'>('day');
const deliveryMode = ref('');
const platform = ref('');
const channel = ref('');
const msgid = ref('');

const analytics = useResource(
  () =>
    api.get<Analytics>(
      `${workspace.envUrl}/analytics${query({
        from: from.value,
        to: to.value,
        granularity: granularity.value,
        deliveryMode: deliveryMode.value,
        platform: platform.value,
        channel: channel.value,
      })}`,
    ),
  [from, to, granularity, deliveryMode, platform, channel],
);

const users = useResource(
  () =>
    api.get<UserAnalytics>(
      `${workspace.envUrl}/analytics/users${query({
        from: from.value,
        to: to.value,
        granularity: granularity.value,
        platform: platform.value,
      })}`,
    ),
  [from, to, granularity, platform],
);

const userGroups = computed(() => {
  const value = users.data.value;
  return value
    ? [
        { title: t('By platform'), groups: value.byPlatform },
        { title: t('By vendor'), groups: value.byVendor },
        { title: t('By app version'), groups: value.byAppVersion },
      ]
    : [];
});

const data = computed(() => analytics.data.value);
const totals = computed(() => data.value?.totals ?? null);

const LOSS = [
  { key: 'invalid', label: 'Planned, not valid', help: 'planned − valid' },
  { key: 'notSent', label: 'Valid, not sent', help: 'valid − sent' },
  { key: 'notDelivered', label: 'Sent, not delivered', help: 'sent − delivered' },
  { key: 'notClicked', label: 'Delivered, not clicked', help: 'delivered − clicked' },
  { key: 'notDisplayed', label: 'Of which never displayed', help: 'delivered − displayed' },
] as const;

function lastDays(days: number) {
  // Ranges are local dates in the application's timezone, as the API expects.
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: workspace.timezone });
  const end = Date.now();
  to.value = localDate.format(end);
  from.value = localDate.format(end - (days - 1) * 86_400_000);
}

function openMessage() {
  const value = msgid.value.trim();
  if (value) void router.push(`/messages/${value}`);
}
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ t('Message analytics') }}</h1>
      <p v-if="data">{{ t('{from} to {to}, {timezone}. Figures come from recorded provider and device events.', data.range) }}</p>
    </div>
    <form class="actions" @submit.prevent="openMessage">
      <input v-model="msgid" :placeholder="t('Look up msgid')" :aria-label="t('Look up msgid')" style="width: 220px" />
      <button class="btn" type="submit">{{ t('Open') }}</button>
    </form>
  </div>

  <div class="filters">
    <button class="btn small" type="button" @click="lastDays(7)">{{ t('Last 7 days') }}</button>
    <button class="btn small" type="button" @click="lastDays(30)">{{ t('Last 30 days') }}</button>
    <button class="btn small" type="button" @click="lastDays(90)">{{ t('Last 90 days') }}</button>
    <label class="small muted" for="from">{{ t('From') }}</label>
    <input id="from" v-model="from" type="date" />
    <label class="small muted" for="to">{{ t('To') }}</label>
    <input id="to" v-model="to" type="date" />
    <select v-model="granularity" :aria-label="t('Granularity')">
      <option value="day">{{ t('Daily') }}</option>
      <option value="month">{{ t('Monthly') }}</option>
    </select>
    <select v-model="deliveryMode" :aria-label="t('Delivery mode')">
      <option value="">{{ t('Real and simulated') }}</option>
      <option value="REAL">{{ t('Real devices only') }}</option>
      <option value="SIMULATED">{{ t('Simulated only') }}</option>
    </select>
    <select v-model="platform" :aria-label="t('Platform')">
      <option value="">{{ t('All platforms') }}</option>
      <option value="ANDROID">Android</option>
      <option value="IOS">iOS</option>
      <option value="HARMONYOS">HarmonyOS</option>
    </select>
    <select v-model="channel" :aria-label="t('Channel')">
      <option value="">{{ t('All channels') }}</option>
      <option v-for="id in CHANNEL_CHOICES" :key="id" :value="id">{{ channelLabel(id) }}</option>
    </select>
  </div>

  <StateBlock :loading="analytics.loading.value" :error="analytics.error.value" :has-data="!!data" @retry="analytics.reload">
    <template v-if="data && totals">
      <div v-if="data.simulated" class="notice warn">{{ t('These figures include simulated targets. Choose "Real devices only" to see phones alone.') }}</div>
      <div class="grid cols-4">
        <div class="card stat">
          <div class="label">{{ t('Messages sent') }}</div>
          <div class="value">{{ formatNumber(totals.messagesSent) }}</div>
          <div class="hint">{{ t('messages with at least one send') }}</div>
        </div>
        <div class="card stat">
          <div class="label">{{ t('Delivery rate') }}</div>
          <div class="value">{{ formatRate(totals.deliveryRate) }}</div>
          <div class="hint">{{ t('delivered / sent') }}</div>
        </div>
        <div class="card stat">
          <div class="label">{{ t('Display rate') }}</div>
          <div class="value">{{ formatRate(totals.displayRate) }}</div>
          <div class="hint">{{ t('displayed / delivered') }}</div>
        </div>
        <div class="card stat">
          <div class="label">{{ t('Click-through rate') }}</div>
          <div class="value">{{ formatRate(totals.clickThroughRate) }}</div>
          <div class="hint">{{ t('clicked / displayed') }}</div>
        </div>
      </div>

      <div class="card">
        <h2>{{ granularity === 'day' ? t('Daily trend') : t('Monthly trend') }}</h2>
        <p class="muted small" style="margin: -8px 0 8px">{{ t('Each stage is counted on the day its message was dispatched.') }}</p>
        <TrendChart :points="data.trend" />
      </div>

      <div class="grid cols-2">
        <div class="card">
          <h2>{{ t('Delivery funnel') }}</h2>
          <FunnelBars :summary="totals" />
        </div>
        <div class="card">
          <h2>{{ t('Message loss') }}</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ t('Stage') }}</th>
                  <th>{{ t('Calculation') }}</th>
                  <th class="num">{{ t('Lost') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in LOSS" :key="row.key">
                  <td>{{ t(row.label) }}</td>
                  <td class="muted small">{{ t(row.help) }}</td>
                  <td class="num">{{ formatNumber(totals.loss[row.key]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="grid cols-2">
        <BreakdownTable :title="t('By delivery mode')" :groups="data.byDeliveryMode" />
        <BreakdownTable :title="t('By platform')" :groups="data.byPlatform" loss />
        <BreakdownTable :title="t('By channel')" :groups="data.byChannel" channels loss />
        <BreakdownTable :title="t('By message type')" :groups="data.byMessageType" />
        <BreakdownTable :title="t('By app version')" :groups="data.byAppVersion" />
      </div>

      <div class="grid cols-2">
        <div class="card">
          <h2>{{ t('Channel attempts') }}</h2>
          <p class="muted small" style="margin: -8px 0 8px">{{ t('Every attempt, including failures before a fallback. A target can have several, so these do not add up to the funnel.') }}</p>
          <div v-if="data.channelAttempts.length === 0" class="state">{{ t('No attempts in this range') }}</div>
          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ t('Channel') }}</th>
                  <th class="num">{{ t('Accepted') }}</th>
                  <th class="num">{{ t('Failed') }}</th>
                  <th class="num">{{ t('Skipped') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in data.channelAttempts" :key="row.channel">
                  <td>{{ channelLabel(row.channel) }}</td>
                  <td class="num">{{ formatNumber(row.accepted) }}</td>
                  <td class="num">{{ formatNumber(row.failed) }}</td>
                  <td class="num">{{ formatNumber(row.skipped) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h2>{{ t('Failure reasons') }}</h2>
          <div v-if="data.failureReasons.length === 0" class="state">{{ t('No failures in this range') }}</div>
          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ t('Reason') }}</th>
                  <th>{{ t('Stage') }}</th>
                  <th class="num">{{ t('Targets') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in data.failureReasons" :key="`${row.stage}:${row.reason}`">
                  <td><code>{{ row.reason }}</code></td>
                  <td class="small">{{ failureStage(row.stage) }}</td>
                  <td class="num">{{ formatNumber(row.count) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <template v-if="users.data.value">
        <h2 style="margin: 18px 0 10px">{{ t('Push users') }}</h2>
        <div class="grid cols-4">
          <div class="card stat">
            <div class="label">{{ t('Registered') }}</div>
            <div class="value">{{ formatNumber(users.data.value.totals.total) }}</div>
            <div class="hint">{{ t('devices now') }}</div>
          </div>
          <div class="card stat">
            <div class="label">{{ t('New users') }}</div>
            <div class="value">{{ formatNumber(users.data.value.totals.newUsers) }}</div>
            <div class="hint">{{ t('registered in this range') }}</div>
          </div>
          <div class="card stat">
            <div class="label">{{ t('Active users') }}</div>
            <div class="value">{{ formatNumber(users.data.value.totals.activeUsers) }}</div>
            <div class="hint">{{ t('last seen in this range') }}</div>
          </div>
          <div class="card stat">
            <div class="label">{{ t('Online users') }}</div>
            <div class="value">{{ formatNumber(users.data.value.totals.online) }}</div>
            <div class="hint">{{ t('online now') }}</div>
          </div>
        </div>
        <div class="grid cols-2">
          <div v-for="section in userGroups" :key="section.title" class="card">
            <h2>{{ section.title }}</h2>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{{ t('Group') }}</th>
                    <th class="num">{{ t('Registered') }}</th>
                    <th class="num">{{ t('New') }}</th>
                    <th class="num">{{ t('Active') }}</th>
                    <th class="num">{{ t('Online') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="group in section.groups" :key="group.key">
                    <td class="nowrap">{{ group.key }}</td>
                    <td class="num">{{ formatNumber(group.total) }}</td>
                    <td class="num">{{ formatNumber(group.newUsers) }}</td>
                    <td class="num">{{ formatNumber(group.activeUsers) }}</td>
                    <td class="num">{{ formatNumber(group.online) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <h2>{{ granularity === 'day' ? t('Daily users') : t('Monthly users') }}</h2>
            <p class="muted small" style="margin: -8px 0 8px">{{ t('Each device counts as active once, on the last day it was seen.') }}</p>
            <div class="table-wrap" style="max-height: 240px; overflow-y: auto">
              <table>
                <thead>
                  <tr>
                    <th>{{ t('Period') }}</th>
                    <th class="num">{{ t('New') }}</th>
                    <th class="num">{{ t('Active') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="point in users.data.value.trend" :key="point.bucket">
                    <td class="nowrap">{{ point.bucket }}</td>
                    <td class="num">{{ formatNumber(point.newUsers) }}</td>
                    <td class="num">{{ formatNumber(point.activeUsers) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </template>
    </template>
  </StateBlock>
</template>
