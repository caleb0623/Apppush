import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import AppsView from '@/views/AppsView.vue';

const post = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  api: { post, get },
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

describe('AppsView', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    push.mockReset();
    get.mockResolvedValue({ data: [] });
    post.mockResolvedValue({
      data: {
        application: { id: 9 },
        credentials: { appKey: 'key', masterSecret: 'the-only-copy-of-the-secret', notice: 'Shown once' },
      },
    });
  });

  it('keeps the workspace unchanged until the one-time secret is dismissed', async () => {
    // Switching workspace remounts the page, which would lose the secret.
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = { id: 1, email: 'a@b.c', name: 'Admin', role: 'ADMIN' };
    const workspace = useWorkspaceStore();
    const refresh = vi.spyOn(workspace, 'refresh').mockResolvedValue();
    const selectApp = vi.spyOn(workspace, 'selectApp');

    const wrapper = mount(AppsView, {
      global: { plugins: [pinia], stubs: { RouterLink: true, teleport: true } },
    });
    await flushPromises();

    await wrapper.findAll('button').find((b) => b.text() === 'Create application')!.trigger('click');
    await wrapper.find('#app-name').setValue('New app');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('the-only-copy-of-the-secret');
    expect(refresh).not.toHaveBeenCalled();
    expect(selectApp).not.toHaveBeenCalled();

    await wrapper.find('input[type=checkbox]').setValue(true);
    await wrapper.findAll('button').find((b) => b.text() === 'Close')!.trigger('click');
    await flushPromises();

    expect(refresh).toHaveBeenCalledOnce();
    expect(selectApp).toHaveBeenCalledWith(9);
    expect(push).toHaveBeenCalledWith('/apps/9');
  });
});
