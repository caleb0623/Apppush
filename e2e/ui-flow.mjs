// Browser end-to-end check of the twelve-step journey in section 7 of the brief.
// Needs the stack running (npm run dev) and uses the installed Microsoft Edge, so no browser download.
// It creates one uniquely named application in the development database and deactivates it at the end.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const shots = join(root, 'e2e', 'screenshots');
mkdirSync(shots, { recursive: true });

const envFile = readFileSync(join(root, 'backend', '.env'), 'utf8');
const setting = (key) => new RegExp(`^${key}=(.*)$`, 'm').exec(envFile)?.[1]?.trim();
const email = setting('SEED_ADMIN_EMAIL');
const password = setting('SEED_ADMIN_PASSWORD');

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = process.env.E2E_BROWSER ?? edgePaths.find(existsSync);
if (!executablePath) throw new Error('Set E2E_BROWSER to a Chromium-based browser executable');

const results = [];
async function step(name, run) {
  const started = Date.now();
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      ${String(error.message).split('\n')[0]}`);
    await page.screenshot({ path: join(shots, 'failure.png'), fullPage: true }).catch(() => undefined);
    throw error;
  }
}

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(12_000);
// Vite compiles modules on first request, so a fresh dev server loads its first page slowly.
page.setDefaultNavigationTimeout(90_000);

const consoleErrors = [];
page.on('console', (message) => {
  // A rejected request logs a resource error by design; those are asserted through the UI.
  if (message.type() === 'error' && !/status of (4\d\d)/.test(message.text())) {
    consoleErrors.push(message.text());
  }
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
const nav = (text) => page.getByRole('link', { name: text, exact: true }).first().click();
const closeSecret = async () => {
  await page.getByText('I have stored this secret').click();
  await page.locator('.modal-foot').getByRole('button', { name: 'Close', exact: true }).click();
};
const toast = (text) => page.locator('.toast', { hasText: text }).first().waitFor();

const appName = `E2E Journey ${Date.now()}`;
const suffix = Date.now().toString(36);
let msgid = '';

try {
  await step('1. Log in, after rejecting a wrong password', async () => {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', 'definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').getByText('Incorrect email or password').waitFor();
    await page.fill('#password', password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  });

  await step('2. Create an application and see the one-time secret', async () => {
    await nav('Applications');
    await page.getByRole('button', { name: 'Create application' }).click();
    await page.fill('#app-name', appName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const secret = await page.getByTestId('master-secret').textContent();
    if (!secret || secret.length < 40) throw new Error('Master Secret was not displayed');
    await closeSecret();
    await page.getByRole('heading', { name: appName }).waitFor();
    if ((await page.content()).includes(secret)) throw new Error('Secret is still on the page after closing');
  });

  await step('3. Register test devices', async () => {
    await nav('Devices');
    await page.getByText('No devices found').waitFor();
    for (const [id, platform, vendor] of [
      [`android-${suffix}`, 'ANDROID', 'xiaomi'],
      [`iphone-${suffix}`, 'IOS', 'apple'],
    ]) {
      await page.getByRole('button', { name: 'Register device' }).click();
      await page.fill('#rid', id);
      await page.selectOption('#device-platform', platform);
      await page.fill('#device-vendor', vendor);
      await page.getByRole('button', { name: 'Register', exact: true }).click();
      await page.getByRole('cell', { name: id }).waitFor();
    }
  });

  await step('4. Make FCM fail in the simulator, so that fallback runs', async () => {
    await nav('Applications');
    await page.getByRole('link', { name: appName }).click();
    await page.getByRole('combobox', { name: 'FCM outcome' }).selectOption('fail');
    await page.getByLabel('FCM failure reason').fill('FCM_DOWN');
    await page.getByRole('button', { name: 'Save production configuration' }).click();
    await toast('production environment only');
  });

  await step('5 and 6. Create a notification, pick a strategy and send it', async () => {
    await nav('New push');
    await page.getByRole('button', { name: 'Send push' }).click();
    await page.getByText('Title is required').waitFor();
    await page.fill('#title', 'Journey notification');
    await page.fill('#body', 'Sent by the end-to-end check');
    await page.selectOption('#strategy', 'fcm_mtpush');
    await page.getByRole('button', { name: 'Send push' }).click();
    await page.waitForURL(/\/messages\/\d+/);
    msgid = page.url().split('/').pop();
    await page.getByRole('heading', { name: 'Journey notification' }).waitFor();
  });

  await step('7. Inspect the msgid and delivery attempts', async () => {
    await page.getByText(msgid).first().waitFor();
    await page.getByText('fallback: EngageLab').waitFor();
    await page.getByText('No real device received this message').waitFor();
    const row = page.getByRole('row', { name: new RegExp(`android-${suffix}`) });
    await row.getByText('FCM', { exact: true }).waitFor();
    await row.getByText('Failed').waitFor();
    await shot('message-detail');
  });

  await step('8. Record simulated display and click events', async () => {
    await page.getByRole('button', { name: 'Record display' }).click();
    await toast('Recorded 2 simulated displayed events');
    await page.getByRole('button', { name: 'Record click' }).click();
    await toast('Recorded 2 simulated clicked events');
  });

  await step('9. See the analytics update', async () => {
    await nav('Message analytics');
    await page.getByRole('heading', { name: 'Message analytics' }).waitFor();
    const funnel = page.getByRole('list', { name: 'Delivery funnel' });
    await funnel.getByRole('listitem').filter({ hasText: 'Clicked' }).filter({ hasText: '2' }).waitFor();
    await page.getByRole('row', { name: /FCM_DOWN/ }).count();
    await page.getByRole('cell', { name: 'EngageLab' }).first().waitFor();
    await shot('analytics-new-app');
  });

  await step('10. Schedule a notification and watch the worker process it', async () => {
    await nav('New push');
    await page.fill('#title', 'Scheduled journey');
    await page.fill('#body', 'Runs a few seconds from now');
    await page.getByLabel('Schedule', { exact: true }).check();
    // The form takes wall-clock time in the application's timezone.
    const at = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      dateStyle: 'short',
      timeStyle: 'medium',
    })
      .format(Date.now() + 6000)
      .replace(' ', 'T');
    await page.fill('#scheduled-at', at);
    await page.getByRole('button', { name: 'Schedule message' }).click();
    await page.waitForURL(/\/scheduled/);
    const row = page.getByRole('row', { name: /Scheduled journey/ });
    await row.getByText('Pending').waitFor();
    await page.getByText('Worker online').waitFor();
    await row.getByText('Completed').waitFor({ timeout: 30_000 });
    await shot('scheduled');
  });

  await step('11. Switch between production and testing configurations', async () => {
    await nav('Applications');
    await page.getByRole('link', { name: appName }).click();
    await page.getByRole('button', { name: 'Enable testing environment' }).click();
    await closeSecret();
    await page.getByText('10 requests per second').waitFor();
    await page.fill('#cfg-callback', 'https://testing.example/hook');
    await page.getByRole('button', { name: 'Save testing configuration' }).click();
    await toast('testing environment only');
    await page.getByRole('group', { name: 'Environment to configure' }).getByRole('button', { name: 'Production' }).click();
    if ((await page.inputValue('#cfg-callback')) !== '') throw new Error('Testing callback leaked into production');

    await page.getByRole('group', { name: 'Environment', exact: true }).getByRole('button', { name: 'Testing' }).click();
    await nav('Devices');
    await page.getByText('Testing environment capacity: 0 of 1,000 devices').waitFor();
  });

  await step('12. See validation errors when limits are exceeded', async () => {
    await page.getByRole('button', { name: 'Register device' }).click();
    await page.fill('#rid', `limit-${suffix}`);
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    await page.getByRole('cell', { name: `limit-${suffix}` }).waitFor();

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.fill('#edit-tags', Array.from({ length: 11 }, (_, i) => `t${i}`).join(', '));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('alert').getByText('at most 10 tags per device').waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();

    const statuses = await page.evaluate(async () => {
      const app = JSON.parse(localStorage.getItem('apppush.workspace'));
      const token = localStorage.getItem('apppush.token');
      const apps = await (await fetch('/api/v1/apps?pageSize=100', { headers: { Authorization: `Bearer ${token}` } })).json();
      const env = apps.data.find((a) => a.id === app.appId).environments.find((e) => e.type === 'TESTING');
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          fetch(`/api/v1/environments/${env.id}/devices`, { headers: { Authorization: `Bearer ${token}` } }),
        ),
      );
      return responses.map((r) => r.status);
    });
    const limited = statuses.filter((s) => s === 429).length;
    if (limited < 10) throw new Error(`Expected at least 10 of 20 requests rejected, got ${limited}`);
    console.log(`      QPS: ${statuses.filter((s) => s === 200).length} allowed, ${limited} rejected with 429`);
    await page.waitForTimeout(1100);
  });

  await step('Switch the console to Chinese and back with one button', async () => {
    await page.getByRole('button', { name: '中文', exact: true }).click();
    await page.getByRole('link', { name: '仪表盘', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('link', { name: '仪表盘', exact: true }).waitFor();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('link', { name: 'Dashboard', exact: true }).waitFor();
  });

  await step('All 13 console pages render without errors', async () => {
    await page.getByRole('group', { name: 'Environment', exact: true }).getByRole('button', { name: 'Production' }).click();
    await page.selectOption('#app-select', { label: '[Demo] ShopNow' });
    for (const [text, heading, file] of [
      ['Dashboard', 'Dashboard', 'dashboard'],
      ['Message analytics', 'Message analytics', 'analytics'],
      ['New push', 'New push', 'push-new'],
      ['Message history', 'Message history', 'messages'],
      ['Scheduled', 'Scheduled messages', 'scheduled-demo'],
      ['Devices', 'Devices', 'devices'],
      ['Tags and aliases', 'Tags and aliases', 'tags'],
      ['Applications', 'Applications', 'apps'],
      ['API documentation', 'API documentation', 'api-docs'],
      ['Settings', 'Settings', 'settings'],
    ]) {
      await nav(text);
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      await page.waitForLoadState('networkidle');
      await shot(file);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`${text} scrolls sideways at desktop width`);
    }
    await page.getByRole('link', { name: '[Demo] ShopNow' }).first().click().catch(() => undefined);
  });

  await step('Pages fit a phone-width screen', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const path of ['/', '/analytics', '/messages', '/devices', '/push/new']) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`${path} scrolls sideways at phone width`);
    }
    await shot('mobile-push');
    await page.setViewportSize({ width: 1360, height: 900 });
  });

  await step('No unexpected browser errors', async () => {
    if (consoleErrors.length > 0) throw new Error(consoleErrors.slice(0, 3).join(' | '));
  });

  await step('Clean up: deactivate the test application', async () => {
    await page.goto(`${BASE}/apps`);
    await page.getByRole('link', { name: appName }).click();
    await page.getByRole('button', { name: 'Deactivate' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
    await toast('Application deactivated');
  });
} finally {
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} steps passed. Screenshots: e2e/screenshots`);
  if (passed !== results.length) process.exitCode = 1;
}
