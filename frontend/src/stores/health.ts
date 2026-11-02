import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Health } from '@/api/types';

export const useHealthStore = defineStore('health', () => {
  const health = ref<Health | null>(null);

  // /api/health sits outside the /api/v1 prefix that the client adds.
  async function refresh() {
    health.value = await fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .catch(() => null);
  }

  const fcmConfigured = computed(() => health.value?.fcm?.configured ?? false);

  return { health, fcmConfigured, refresh };
});
