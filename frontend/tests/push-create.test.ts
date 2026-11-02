import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/api/client';
import { useWorkspaceStore } from '@/stores/workspace';
import PushCreateView from '@/views/PushCreateView.vue';

const post = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  api: { post, get },
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const app = {
  id: 1,
  name: 'Demo',
  timezone: 'Asia/Shanghai',
  status: 'ACTIVE',
  environments: [{ id: 7, type: 'PRODUCTION', appKey: 'k' }],
};

function render() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useWorkspaceStore().apps = [app] as never;
  return mount(PushCreateView, { global: { plugins: [pinia] } });
}

const body = () => post.mock.calls[0]?.[1] as Record<string, unknown>;

describe('PushCreateView', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    push.mockReset();
    get.mockResolvedValue({ data: [] });
    post.mockResolvedValue({ data: { msgid: 'm1', status: 'COMPLETED', scheduleType: 'IMMEDIATE' } });
  });

  const phone = { id: 1, registrationId: 'rid_phone', deliveryMode: 'REAL', model: 'Pixel 8', platform: 'ANDROID' };
  const record = { id: 2, registrationId: 'sim-1', deliveryMode: 'SIMULATED', model: null, vendor: null, platform: 'IOS' };

  it('targets the selected devices and lists real phones first', async () => {
    get.mockResolvedValue({ data: [record, phone] });
    const wrapper = render();
    await flushPromises();
    await wrapper.find('#title').setValue('T');
    await wrapper.find('#body').setValue('B');
    await wrapper.find('#audience').setValue('REGISTRATION_IDS');

    await wrapper.find('form').trigger('submit');
    expect(post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Select at least one device');

    const boxes = wrapper.findAll('.device-picker input');
    expect(wrapper.find('.device-picker label').text()).toContain('rid_phone');
    await boxes[0]!.setValue(true);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(body()).toMatchObject({ audience: { type: 'REGISTRATION_IDS', values: ['rid_phone'] } });
  });

  it('warns when a plan has no FCM step and a real phone is targeted', async () => {
    get.mockResolvedValue({ data: [phone] });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).not.toContain('will not receive it');

    await wrapper.find('#strategy').setValue('mtpush');
    expect(wrapper.text()).toContain('will not receive it');

    await wrapper.find('#channel').setValue('fcm');
    expect(wrapper.text()).not.toContain('will not receive it');
  });

  it('sends a chosen channel, and omits it when automatic', async () => {
    const wrapper = render();
    await wrapper.find('#title').setValue('T');
    await wrapper.find('#body').setValue('B');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(body()).not.toHaveProperty('channel');

    post.mockClear();
    await wrapper.find('#channel').setValue('fcm');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(body()).toMatchObject({ channel: 'fcm' });
  });

  it('blocks submission and shows field errors for an empty notification', async () => {
    const wrapper = render();
    await wrapper.find('form').trigger('submit');
    expect(post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Title is required');
    expect(wrapper.text()).toContain('Body is required');
  });

  it('submits a notification to the selected environment and opens its details', async () => {
    const wrapper = render();
    await wrapper.find('#title').setValue('Sale');
    await wrapper.find('#body').setValue('Today only');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(post.mock.calls[0]?.[0]).toBe('/environments/7/messages');
    expect(body()).toMatchObject({
      type: 'NOTIFICATION',
      title: 'Sale',
      body: 'Today only',
      strategy: 'fcm_mtpush',
      audience: { type: 'ALL' },
    });
    expect(post.mock.calls[0]?.[2]).toHaveProperty('Idempotency-Key');
    expect(push).toHaveBeenCalledWith('/messages/m1');
  });

  it('keeps the same idempotency key when a failed send is retried', async () => {
    post.mockRejectedValueOnce(new ApiRequestError(0, 'NETWORK_ERROR', 'Offline'));
    const wrapper = render();
    await wrapper.find('#title').setValue('Sale');
    await wrapper.find('#body').setValue('Today only');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Offline');

    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const keys = post.mock.calls.map((call) => (call[2] as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
  });

  it('validates custom JSON before sending', async () => {
    const wrapper = render();
    await wrapper.find('#type').setValue('CUSTOM');
    await wrapper.find('#payload').setValue('{not json');
    await wrapper.find('form').trigger('submit');
    expect(post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('not valid JSON');

    await wrapper.find('#payload').setValue('[1]');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.text()).toContain('must be a JSON object');

    await wrapper.find('#payload').setValue('{"a":1}');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(body()).toMatchObject({ type: 'CUSTOM', customPayload: { a: 1 } });
    expect(body()).not.toHaveProperty('title');
  });

  it('shows the configuration field for a style and sends it', async () => {
    const wrapper = render();
    await wrapper.find('#title').setValue('T');
    await wrapper.find('#body').setValue('B');
    await wrapper.find('#style').setValue('INBOX');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.text()).toContain('Inbox lines is required');

    await wrapper.find('#style-value').setValue('one\ntwo');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(body()).toMatchObject({ style: 'INBOX', styleConfig: { lines: ['one', 'two'] } });
  });

  it('requires a time when scheduling, and sends it without an offset', async () => {
    post.mockResolvedValue({ data: { msgid: 'm2', status: 'PENDING', scheduleType: 'SCHEDULED' } });
    const wrapper = render();
    await wrapper.find('#title').setValue('T');
    await wrapper.find('#body').setValue('B');
    await wrapper.find('input[value=later]').setValue();
    await wrapper.find('form').trigger('submit');
    expect(wrapper.text()).toContain('Choose a date and time');

    await wrapper.find('#scheduled-at').setValue('2030-01-01T09:00');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(body().scheduledAt).toBe('2030-01-01T09:00');
    expect(push).toHaveBeenCalledWith('/scheduled');
  });

  it('requires audience values and at least one platform', async () => {
    const wrapper = render();
    await wrapper.find('#title').setValue('T');
    await wrapper.find('#body').setValue('B');
    await wrapper.find('#audience').setValue('TAGS');
    for (const box of wrapper.findAll('input[type=checkbox]')) await box.setValue(false);
    await wrapper.find('form').trigger('submit');
    expect(post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Enter at least one value');
    expect(wrapper.text()).toContain('Select at least one platform');
  });

  it('shows server validation errors on the form', async () => {
    post.mockRejectedValueOnce(
      new ApiRequestError(400, 'VALIDATION_ERROR', 'Request validation failed', [
        { field: 'title', message: 'Title rejected by server' },
      ]),
    );
    const wrapper = render();
    await wrapper.find('#title').setValue('T');
    await wrapper.find('#body').setValue('B');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Title rejected by server');
  });
});

describe('workspace store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('switches environment and exposes its ID and URL', () => {
    setActivePinia(createPinia());
    const workspace = useWorkspaceStore();
    workspace.apps = [
      {
        ...app,
        environments: [
          { id: 7, type: 'PRODUCTION', appKey: 'p' },
          { id: 8, type: 'TESTING', appKey: 't' },
        ],
      },
    ] as never;
    expect(workspace.envId).toBe(7);
    workspace.selectEnvironment('TESTING');
    expect(workspace.envId).toBe(8);
    expect(workspace.envUrl).toBe('/environments/8');
    expect(workspace.hasTesting).toBe(true);
  });

  it('opens on production, even after testing was used last time', () => {
    localStorage.setItem('apppush.workspace', JSON.stringify({ appId: 1, envType: 'TESTING' }));
    setActivePinia(createPinia());
    const workspace = useWorkspaceStore();
    workspace.apps = [
      {
        ...app,
        environments: [
          { id: 7, type: 'PRODUCTION', appKey: 'p' },
          { id: 8, type: 'TESTING', appKey: 't' },
        ],
      },
    ] as never;
    expect(workspace.environment?.type).toBe('PRODUCTION');
  });

  it('falls back to production when the app has no testing environment', () => {
    setActivePinia(createPinia());
    const workspace = useWorkspaceStore();
    workspace.apps = [app] as never;
    workspace.selectEnvironment('TESTING');
    expect(workspace.environment?.type).toBe('PRODUCTION');
  });
});
