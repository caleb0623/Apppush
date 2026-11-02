<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '@/api/client';
import LanguageToggle from '@/components/LanguageToggle.vue';
import { roleLabel } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';
import { useHealthStore } from '@/stores/health';
import { useWorkspaceStore } from '@/stores/workspace';

const auth = useAuthStore();
const health = useHealthStore();
const workspace = useWorkspaceStore();
const router = useRouter();
const route = useRoute();
const loadError = ref<string | null>(null);

const groups = [
  { label: 'Overview', links: [{ to: '/', text: 'Dashboard' }, { to: '/analytics', text: 'Message analytics' }] },
  {
    label: 'Messaging',
    links: [
      { to: '/push/new', text: 'New push' },
      { to: '/messages', text: 'Message history' },
      { to: '/scheduled', text: 'Scheduled' },
    ],
  },
  { label: 'Audience', links: [{ to: '/devices', text: 'Devices' }, { to: '/tags', text: 'Tags and aliases' }] },
  {
    label: 'Admin',
    links: [
      { to: '/apps', text: 'Applications' },
      { to: '/api-docs', text: 'API documentation' },
      { to: '/settings', text: 'Settings' },
    ],
  },
] as const;

async function load() {
  loadError.value = null;
  try {
    await workspace.refresh();
  } catch (error) {
    loadError.value = errorMessage(error);
  }
}

function logout() {
  auth.logout();
  void router.push({ name: 'login' });
}

onMounted(() => {
  void load();
  void health.refresh();
});
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">A</span> AppPush</div>
      <nav :aria-label="t('Main')">
        <template v-for="group in groups" :key="group.label">
          <div class="nav-group">{{ t(group.label) }}</div>
          <RouterLink v-for="link in group.links" :key="link.to" :to="link.to" class="nav-link">
            {{ t(link.text) }}
          </RouterLink>
        </template>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <template v-if="workspace.app">
          <label class="small muted" for="app-select">{{ t('Application') }}</label>
          <select
            id="app-select"
            style="width: auto; max-width: 240px"
            :value="workspace.app.id"
            @change="workspace.selectApp(Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="app in workspace.apps" :key="app.id" :value="app.id">{{ app.name }}</option>
          </select>
          <div class="env-switch" role="group" :aria-label="t('Environment')">
            <button
              type="button"
              :class="{ on: workspace.environment?.type === 'PRODUCTION' }"
              @click="workspace.selectEnvironment('PRODUCTION')"
            >
              {{ t('Production') }}
            </button>
            <button
              type="button"
              :class="{ on: workspace.environment?.type === 'TESTING' }"
              :disabled="!workspace.hasTesting"
              :title="workspace.hasTesting ? '' : t('Enable a testing environment on the application page')"
              @click="workspace.selectEnvironment('TESTING')"
            >
              {{ t('Testing') }}
            </button>
          </div>
          <span v-if="workspace.app.status === 'INACTIVE'" class="badge bad">{{ t('Inactive') }}</span>
        </template>
        <span class="spacer"></span>
        <span v-if="health.fcmConfigured" class="badge good" :title="t('Firebase project {id}', { id: health.health?.fcm.projectId ?? '' })">{{ t('FCM configured') }}</span>
        <span v-else class="badge warn" :title="t('Add Firebase credentials to reach real devices. See docs/firebase-setup.md.')">{{ t('FCM not configured') }}</span>
        <span class="small">{{ auth.user?.name }} <span class="muted">({{ auth.user ? roleLabel(auth.user.role) : '' }})</span></span>
        <LanguageToggle />
        <button class="btn small" type="button" @click="logout">{{ t('Log out') }}</button>
      </header>

      <main class="content">
        <div v-if="loadError" class="notice bad">
          {{ loadError }} <button class="link" type="button" @click="load">{{ t('Retry') }}</button>
        </div>
        <div v-if="!workspace.loaded && !loadError" class="state"><div class="spinner"></div>{{ t('Loading workspace…') }}</div>
        <div v-else-if="workspace.loaded && route.meta.scoped && !workspace.envId" class="state">
          <strong>{{ t('Create an application first') }}</strong>
          {{ t('Devices, messages and analytics belong to an application.') }}
          <div><RouterLink class="btn primary" to="/apps">{{ t('Go to applications') }}</RouterLink></div>
        </div>
        <RouterView v-else-if="workspace.loaded" :key="`${workspace.envId}`" />
      </main>
    </div>
  </div>
</template>
