<script setup lang="ts">
import { t } from '@/lib/i18n';

/** Shows loading, error or empty states, and the content otherwise. */
withDefaults(
  defineProps<{
    loading: boolean;
    error: string | null;
    hasData: boolean;
    empty?: boolean;
    emptyTitle?: string;
    emptyText?: string;
  }>(),
  { empty: false, emptyTitle: undefined, emptyText: '' },
);
defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="error" class="state" role="alert">
    <strong>{{ t('This could not be loaded') }}</strong>
    {{ error }}
    <div><button class="btn" type="button" @click="$emit('retry')">{{ t('Try again') }}</button></div>
  </div>
  <div v-else-if="loading && !hasData" class="state"><div class="spinner"></div>{{ t('Loading…') }}</div>
  <div v-else-if="empty" class="state">
    <strong>{{ emptyTitle ?? t('Nothing here yet') }}</strong>
    {{ emptyText }}
    <slot name="empty-action"></slot>
  </div>
  <!-- Keeps the previous render on refetch, so the page does not jump. -->
  <div v-else :class="{ stale: loading }"><slot></slot></div>
</template>
