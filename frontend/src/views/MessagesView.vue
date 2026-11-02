<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, query } from '@/api/client';
import type { Message } from '@/api/types';
import PaginationBar from '@/components/PaginationBar.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { useResource } from '@/composables/useResource';
import { STRATEGIES, formatDateTime, formatNumber, formatRate, messageTitle, valueLabel } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useWorkspaceStore } from '@/stores/workspace';

const workspace = useWorkspaceStore();
const page = ref(1);
const search = ref('');
const status = ref('');
const type = ref('');
const strategy = ref('');
watch([search, status, type, strategy], () => {
  page.value = 1;
});

const list = useResource(
  () =>
    api.get<Message[]>(
      `${workspace.envUrl}/messages${query({
        page: page.value,
        search: search.value,
        status: status.value,
        type: type.value,
        strategy: strategy.value,
      })}`,
    ),
  [page, search, status, type, strategy],
);
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ t('Message history') }}</h1>
      <p>{{ t('Every message in this environment, with its delivery funnel.') }}</p>
    </div>
    <RouterLink class="btn primary" to="/push/new">{{ t('New push') }}</RouterLink>
  </div>

  <div class="card">
    <div class="filters">
      <input v-model.lazy="search" type="search" :placeholder="t('Title or msgid')" :aria-label="t('Title or msgid')" />
      <select v-model="status" :aria-label="t('Status')">
        <option value="">{{ t('All statuses') }}</option>
        <option v-for="value in ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']" :key="value" :value="value">
          {{ valueLabel(value) }}
        </option>
      </select>
      <select v-model="type" :aria-label="t('Type')">
        <option value="">{{ t('All types') }}</option>
        <option value="NOTIFICATION">{{ t('Notification') }}</option>
        <option value="CUSTOM">{{ t('Custom') }}</option>
        <option value="IN_APP">{{ t('In-app') }}</option>
      </select>
      <select v-model="strategy" :aria-label="t('Strategy')">
        <option value="">{{ t('All strategies') }}</option>
        <option v-for="item in STRATEGIES" :key="item.id" :value="item.id">{{ item.id }}</option>
      </select>
    </div>

    <StateBlock
      :loading="list.loading.value"
      :error="list.error.value"
      :has-data="!!list.data.value"
      :empty="list.data.value?.length === 0"
      :empty-title="t('No messages found')"
      :empty-text="t('Try different filters, or send a push.')"
      @retry="list.reload"
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('Message') }}</th>
              <th>msgid</th>
              <th>{{ t('Status') }}</th>
              <th>{{ t('Strategy') }}</th>
              <th class="num">{{ t('Valid') }}</th>
              <th class="num">{{ t('Sent') }}</th>
              <th class="num">{{ t('Delivered') }}</th>
              <th class="num">{{ t('Delivery rate') }}</th>
              <th>{{ t('Dispatched') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="message in list.data.value" :key="message.id">
              <td>
                <RouterLink :to="`/messages/${message.msgid}`">{{ messageTitle(message) }}</RouterLink>
                <div class="muted small">{{ valueLabel(message.type) }}</div>
              </td>
              <td><code>{{ message.msgid }}</code></td>
              <td><StatusBadge :status="message.status" /></td>
              <td><code>{{ message.strategy }}</code></td>
              <td class="num">{{ formatNumber(message.funnel?.valid ?? 0) }}</td>
              <td class="num">{{ formatNumber(message.funnel?.sent ?? 0) }}</td>
              <td class="num">{{ formatNumber(message.funnel?.delivered ?? 0) }}</td>
              <td class="num">{{ formatRate(message.funnel?.deliveryRate) }}</td>
              <td class="nowrap">{{ formatDateTime(message.dispatchedAt, workspace.timezone) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar v-model="page" :meta="list.meta.value" />
    </StateBlock>
  </div>
</template>
