import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiRequestError, errorMessage } from '@/api/client';
import LanguageToggle from '@/components/LanguageToggle.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { channelLabel, eventLabel, formatDateTime, messageTitle, relativeSeconds } from '@/lib/format';
import { locale, setLocale, t, translate, translateServerText } from '@/lib/i18n';
import { zh } from '@/lib/zh';

afterEach(() => setLocale('en'));

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dictionary', () => {
  it('keeps every placeholder and leaves no entry empty', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim(), key).not.toBe('');
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });
});

describe('switching language', () => {
  it('shows English until Chinese is chosen', () => {
    expect(locale.value).toBe('en');
    expect(t('Dashboard')).toBe('Dashboard');
    setLocale('zh');
    expect(t('Dashboard')).toBe('仪表盘');
  });

  it('fills in values in both languages', () => {
    const params = { total: '1,200', page: 2, pages: 5 };
    expect(t('{total} total, page {page} of {pages}', params)).toBe('1,200 total, page 2 of 5');
    setLocale('zh');
    expect(t('{total} total, page {page} of {pages}', params)).toBe('共 1,200 条，第 2 / 5 页');
  });

  it('remembers the choice, and marks the page for the browser', () => {
    setLocale('zh');
    expect(localStorage.getItem('apppush.locale')).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('AppPush 控制台');
  });

  it('changes a mounted page, with one button', async () => {
    const button = mount(LanguageToggle);
    const badge = mount(StatusBadge, { props: { status: 'COMPLETED' } });
    expect(button.text()).toBe('中文');
    expect(badge.text()).toBe('Completed');

    await button.trigger('click');
    await badge.vm.$nextTick();
    expect(button.text()).toBe('English');
    expect(badge.text()).toBe('已完成');

    await button.trigger('click');
    await badge.vm.$nextTick();
    expect(badge.text()).toBe('Completed');
  });
});

describe('labels in Chinese', () => {
  it('translates channels, events and message names', () => {
    setLocale('zh');
    expect(channelLabel('xiaomi')).toBe('小米');
    expect(channelLabel('fcm')).toBe('FCM');
    expect(eventLabel({ type: 'DISPLAYED', source: 'DEVICE_CLIENT', inferred: true })).toBe('已展示（设备上报，推断）');
    expect(messageTitle({ title: null, type: 'IN_APP' })).toBe('应用内消息');
  });

  it('never changes what a sender wrote', () => {
    setLocale('zh');
    expect(messageTitle({ title: 'Order shipped', type: 'NOTIFICATION' })).toBe('Order shipped');
    expect(translate('Some text nobody translated')).toBe('Some text nobody translated');
  });

  it('formats dates and durations', () => {
    setLocale('zh');
    expect(formatDateTime('2026-01-01T00:00:00Z', 'Asia/Shanghai')).toContain('2026年');
    expect(relativeSeconds('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:02:00Z'))).toBe('2 分钟前');
    expect(relativeSeconds(null)).toBe('从未');
  });
});

describe('answers from the API', () => {
  it('stays in the API wording in English', () => {
    expect(translateServerText('Device was not found')).toBe('Device was not found');
  });

  it('translates fixed messages and messages with a value', () => {
    setLocale('zh');
    expect(translateServerText('Incorrect email or password')).toBe('邮箱或密码错误');
    expect(translateServerText('Device was not found')).toBe('找不到设备');
    expect(translateServerText('Testing environments allow at most 10 tags per device')).toBe('测试环境每台设备最多允许 10 个标签');
    expect(translateServerText('Tag "vip" already exists')).toBe('标签“vip”已存在');
  });

  it('applies to request errors and form errors', () => {
    setLocale('zh');
    const error = new ApiRequestError(400, 'VALIDATION_ERROR', 'Request validation failed', [
      { field: 'title', message: 'Title is required' },
    ]);
    expect(errorMessage(error)).toBe('提交的内容未通过校验');
    expect(error.fieldErrors).toEqual({ title: '请填写标题' });
  });

  it('keeps text it does not know', () => {
    setLocale('zh');
    expect(translateServerText('A brand new server message')).toBe('A brand new server message');
  });
});
