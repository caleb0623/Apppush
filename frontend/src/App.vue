<script setup lang="ts">
import { t } from '@/lib/i18n';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();
</script>

<template>
  <RouterView />
  <div class="toasts" role="status" aria-live="polite">
    <div v-for="item in toast.toasts" :key="item.id" class="toast" :class="item.kind">
      <span>{{ item.text }}</span>
      <button class="link" type="button" :aria-label="t('Dismiss')" @click="toast.dismiss(item.id)">✕</button>
    </div>
  </div>
</template>
