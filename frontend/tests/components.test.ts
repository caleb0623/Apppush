import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Summary } from '@/api/types';
import FunnelBars from '@/components/FunnelBars.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import SecretReveal from '@/components/SecretReveal.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';

const summary: Summary = {
  planned: 100,
  valid: 90,
  sent: 80,
  delivered: 60,
  displayed: 30,
  clicked: 6,
  deliveryRate: 0.75,
  displayRate: 0.5,
  clickThroughRate: 0.2,
  loss: { invalid: 10, notSent: 10, notDelivered: 20, notDisplayed: 30, notClicked: 24 },
};

describe('StatusBadge', () => {
  it('always shows a text label alongside the colour', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'COMPLETED' } });
    expect(wrapper.text()).toBe('Completed');
    expect(wrapper.classes()).toContain('good');
  });

  it('marks failures as bad', () => {
    expect(mount(StatusBadge, { props: { status: 'FAILED' } }).classes()).toContain('bad');
  });
});

describe('StateBlock', () => {
  const base = { loading: false, error: null, hasData: true };
  const slots = { default: '<p>Content</p>' };

  it('shows a spinner on first load', () => {
    const wrapper = mount(StateBlock, { props: { ...base, loading: true, hasData: false }, slots });
    expect(wrapper.find('.spinner').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Content');
  });

  it('keeps previous content, dimmed, while refetching', () => {
    const wrapper = mount(StateBlock, { props: { ...base, loading: true }, slots });
    expect(wrapper.text()).toContain('Content');
    expect(wrapper.find('.stale').exists()).toBe(true);
    expect(wrapper.find('.spinner').exists()).toBe(false);
  });

  it('shows an error and offers a retry', async () => {
    const wrapper = mount(StateBlock, { props: { ...base, error: 'It broke' }, slots });
    expect(wrapper.text()).toContain('It broke');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('shows the empty state', () => {
    const wrapper = mount(StateBlock, {
      props: { ...base, empty: true, emptyTitle: 'No devices' },
      slots,
    });
    expect(wrapper.text()).toContain('No devices');
    expect(wrapper.text()).not.toContain('Content');
  });
});

describe('PaginationBar', () => {
  const meta = (page: number, totalPages: number) => ({ page, pageSize: 20, total: 100, totalPages });

  it('is hidden for a single page', () => {
    const wrapper = mount(PaginationBar, { props: { meta: meta(1, 1), modelValue: 1 } });
    expect(wrapper.find('.pagination').exists()).toBe(false);
  });

  it('moves between pages and disables the ends', async () => {
    const wrapper = mount(PaginationBar, { props: { meta: meta(1, 5), modelValue: 1 } });
    const [previous, next] = wrapper.findAll('button');
    expect(previous!.attributes('disabled')).toBeDefined();
    await next!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([2]);
  });
});

describe('FunnelBars', () => {
  it('shows each stage with its value and share of planned targets', () => {
    const text = mount(FunnelBars, { props: { summary } }).text();
    expect(text).toContain('Planned');
    expect(text).toContain('Clicked');
    expect(text).toContain('60.0%');
    expect(text).toContain('6.0%');
  });

  it('handles an empty funnel without dividing by zero', () => {
    const zero = { ...summary, planned: 0, valid: 0, sent: 0, delivered: 0, displayed: 0, clicked: 0 };
    const text = mount(FunnelBars, { props: { summary: zero } }).text();
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('%');
  });
});

describe('SecretReveal', () => {
  const credentials = { appKey: 'key', masterSecret: 's3cret', notice: 'Shown only once' };

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the secret once and cannot close until the user confirms storing it', async () => {
    const wrapper = mount(SecretReveal, { props: { credentials }, attachTo: document.body });
    const dialog = document.body;
    expect(dialog.textContent).toContain('s3cret');
    expect(dialog.textContent).toContain('Shown only once');

    const close = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Close')!;
    expect(close.disabled).toBe(true);
    close.click();
    expect(wrapper.emitted('close')).toBeUndefined();

    const box = dialog.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.click();
    await wrapper.vm.$nextTick();
    expect(close.disabled).toBe(false);
    close.click();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});
