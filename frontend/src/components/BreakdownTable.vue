<script setup lang="ts">
import type { Group } from '@/api/types';
import { channelLabel, formatNumber, formatRate } from '@/lib/format';
import { t, translate } from '@/lib/i18n';

defineProps<{ title: string; groups: Group[]; channels?: boolean; loss?: boolean }>();
</script>

<template>
  <div class="card">
    <h2>{{ title }}</h2>
    <div v-if="groups.length === 0" class="state">{{ t('No data in this range') }}</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('Group') }}</th>
            <th class="num">{{ t('Sent') }}</th>
            <th class="num">{{ t('Delivered') }}</th>
            <th class="num">{{ t('Clicked') }}</th>
            <th class="num">{{ t('Delivery rate') }}</th>
            <th class="num">{{ t('Display rate') }}</th>
            <th class="num">{{ t('CTR') }}</th>
            <template v-if="loss">
              <th class="num">{{ t('Invalid') }}</th>
              <th class="num">{{ t('Not sent') }}</th>
              <th class="num">{{ t('Not delivered') }}</th>
              <th class="num">{{ t('Not clicked') }}</th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr v-for="group in groups" :key="group.key">
            <td class="nowrap">{{ channels ? channelLabel(group.key) : translate(group.key) }}</td>
            <td class="num">{{ formatNumber(group.sent) }}</td>
            <td class="num">{{ formatNumber(group.delivered) }}</td>
            <td class="num">{{ formatNumber(group.clicked) }}</td>
            <td class="num">{{ formatRate(group.deliveryRate) }}</td>
            <td class="num">{{ formatRate(group.displayRate) }}</td>
            <td class="num">{{ formatRate(group.clickThroughRate) }}</td>
            <template v-if="loss">
              <td class="num">{{ formatNumber(group.loss.invalid) }}</td>
              <td class="num">{{ formatNumber(group.loss.notSent) }}</td>
              <td class="num">{{ formatNumber(group.loss.notDelivered) }}</td>
              <td class="num">{{ formatNumber(group.loss.notClicked) }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
