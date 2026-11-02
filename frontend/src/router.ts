import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { setUnauthorizedHandler } from '@/api/client';
import AppShell from '@/components/AppShell.vue';
import { useAuthStore } from '@/stores/auth';

/** `scoped` routes need a selected application and environment. */
const scoped = { scoped: true };

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
  {
    path: '/',
    component: AppShell,
    children: [
      { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: scoped },
      { path: 'apps', name: 'apps', component: () => import('@/views/AppsView.vue') },
      { path: 'apps/:id', name: 'app-detail', component: () => import('@/views/AppDetailView.vue'), props: true },
      { path: 'push/new', name: 'push-new', component: () => import('@/views/PushCreateView.vue'), meta: scoped },
      { path: 'messages', name: 'messages', component: () => import('@/views/MessagesView.vue'), meta: scoped },
      {
        path: 'messages/:msgid',
        name: 'message-detail',
        component: () => import('@/views/MessageDetailView.vue'),
        props: true,
        meta: scoped,
      },
      { path: 'scheduled', name: 'scheduled', component: () => import('@/views/ScheduledView.vue'), meta: scoped },
      { path: 'devices', name: 'devices', component: () => import('@/views/DevicesView.vue'), meta: scoped },
      { path: 'tags', name: 'tags', component: () => import('@/views/TagsAliasesView.vue'), meta: scoped },
      { path: 'analytics', name: 'analytics', component: () => import('@/views/AnalyticsView.vue'), meta: scoped },
      { path: 'api-docs', name: 'api-docs', component: () => import('@/views/ApiDocsView.vue') },
      { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) return true;
  if (!auth.token) return { name: 'login', query: { redirect: to.fullPath } };
  try {
    await auth.restore();
  } catch {
    auth.logout();
    return { name: 'login' };
  }
  return true;
});

setUnauthorizedHandler(() => {
  useAuthStore().logout();
  void router.push({ name: 'login' });
});
