import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, tokenStorage } from '@/api/client';
import type { User } from '@/api/types';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(tokenStorage.get());
  const user = ref<User | null>(null);
  const isAdmin = computed(() => user.value?.role === 'ADMIN');

  async function login(email: string, password: string) {
    const { data } = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    tokenStorage.set(data.token);
    token.value = data.token;
    user.value = data.user;
  }

  async function restore() {
    if (!token.value || user.value) return;
    user.value = (await api.get<User>('/auth/me')).data;
  }

  function logout() {
    tokenStorage.clear();
    token.value = null;
    user.value = null;
  }

  return { token, user, isAdmin, login, restore, logout };
});
