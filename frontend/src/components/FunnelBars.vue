<script setup lang="ts">
import { computed } from 'vue';
import type { Summary } from '@/api/types';
import { formatNumber } from '@/lib/format';
import { t } from '@/lib/i18n';

const props = defineProps<{ summary: Summary }>();

// An ordered ramp, because the stages have a natural order. It is validated with --ordinal.
const STAGES = [
  { key: 'planned', label: 'Planned', color: '#86b6ef' },
  { key: 'valid', label: 'Valid', color: '#5598e7' },
  { key: 'sent', label: 'Sent', color: '#2a78d6' },
  { key: 'delivered', label: 'Delivered', color: '#1c5cab' },
  { key: 'displayed', label: 'Displayed', color: '#104281' },
  { key: 'clicked', label: 'Clicked', color: '#0a2748' },
] as const;

const rows = computed(() => {
  const max = props.summary.planned || 1;
  return STAGES.map((stage) => {
    const value = props.summary[stage.key];
    return { ...stage, value, width: (value / max) * 100, share: props.summary.planned ? value / max : null };
  });
});
</script>

<template>
  <div class="bar-list" role="list" :aria-label="t('Delivery funnel')">
    <div v-for="row in rows" :key="row.key" class="bar-row" role="listitem">
      <span class="key">{{ t(row.label) }}</span>
      <span class="bar-track">
        <span class="bar-fill" :style="{ width: `${row.width}%`, background: row.color }"></span>
      </span>
      <span class="val">
        {{ formatNumber(row.value) }}
        <small v-if="row.share !== null">{{ (row.share * 100).toFixed(1) }}%</small>
      </span>
    </div>
  </div>
</template>
