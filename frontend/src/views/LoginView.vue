<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '@/api/client';
import LanguageToggle from '@/components/LanguageToggle.vue';
import { t } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

async function submit() {
  busy.value = true;
  error.value = null;
  try {
    await auth.login(email.value.trim(), password.value);
    const redirect = route.query.redirect;
    await router.push(typeof redirect === 'string' ? redirect : '/');
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <form class="card" @submit.prevent="submit">
      <div style="display: flex; justify-content: flex-end"><LanguageToggle /></div>
      <div class="brand" style="padding: 0 0 4px"><span class="brand-mark" aria-hidden="true">A</span> {{ t('AppPush Console') }}</div>
      <p class="muted small" style="margin-bottom: 16px">{{ t('Local assessment build. Registered Android devices receive real pushes through FCM.') }}</p>
      <div v-if="error" class="notice bad" role="alert">{{ error }}</div>
      <div class="field">
        <label for="email">{{ t('Email') }}</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="password">{{ t('Password') }}</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" required />
      </div>
      <button class="btn primary" type="submit" style="width: 100%; justify-content: center" :disabled="busy">
        {{ busy ? t('Signing in…') : t('Sign in') }}
      </button>
      <p class="muted small" style="margin-top: 12px">{{ t('The seeded login is set by SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env.') }}</p>
    </form>
  </div>
</template>
