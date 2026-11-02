<script setup lang="ts">
import { computed } from 'vue';
import { valueLabel } from '@/lib/format';

const props = defineProps<{ status: string }>();

const KINDS: Record<string, string> = {
  COMPLETED: 'good',
  DELIVERED: 'good',
  ACTIVE: 'good',
  SENT: 'info',
  ACCEPTED: 'info',
  PROCESSING: 'info',
  PENDING: 'warn',
  SKIPPED: 'warn',
  CANCELLED: '',
  INACTIVE: '',
  INVALID: 'warn',
  FAILED: 'bad',
};

const kind = computed(() => KINDS[props.status] ?? '');
const label = computed(() => valueLabel(props.status));
</script>

<template>
  <span class="badge" :class="kind">{{ label }}</span>
</template>
