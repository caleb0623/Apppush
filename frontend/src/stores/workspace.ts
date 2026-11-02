import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import type { AppSummary, EnvironmentRef } from '@/api/types';

const KEY = 'apppush.workspace';

function rememberedApp(): number | null {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as { appId?: number }).appId ?? null;
  } catch {
    return null;
  }
}

/** The application and environment that the console is currently working in. */
export const useWorkspaceStore = defineStore('workspace', () => {
  const apps = ref<AppSummary[]>([]);
  const loaded = ref(false);
  const appId = ref<number | null>(rememberedApp());
  // Never remembered: the portal always opens on production, and testing is a manual switch.
  const envType = ref<EnvironmentRef['type']>('PRODUCTION');

  const app = computed(() => apps.value.find((a) => a.id === appId.value) ?? apps.value[0] ?? null);
  const environment = computed(() => {
    const environments = app.value?.environments ?? [];
    return environments.find((e) => e.type === envType.value) ?? environments[0] ?? null;
  });
  const envId = computed(() => environment.value?.id ?? null);
  const timezone = computed(() => app.value?.timezone ?? 'UTC');
  const hasTesting = computed(() => app.value?.environments.some((e) => e.type === 'TESTING') ?? false);
  const envUrl = computed(() => `/environments/${envId.value}`);

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ appId: appId.value }));
    } catch {
      // Remembering the selection is only a convenience.
    }
  }

  async function refresh() {
    apps.value = (await api.get<AppSummary[]>('/apps?pageSize=100')).data;
    loaded.value = true;
  }

  function selectApp(id: number) {
    appId.value = id;
    persist();
  }

  function selectEnvironment(type: EnvironmentRef['type']) {
    envType.value = type;
  }

  return {
    apps,
    loaded,
    app,
    environment,
    envId,
    envType,
    timezone,
    hasTesting,
    envUrl,
    refresh,
    selectApp,
    selectEnvironment,
  };
});
