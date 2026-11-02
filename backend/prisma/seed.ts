/**
 * Repeatable demo data. Only records named "[Demo] ..." are replaced, so anything
 * created by hand survives. Message history is produced by the real dispatcher,
 * so analytics are computed from genuine targets, attempts and events.
 */
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { env } from '../src/config/env.js';
import { createDeps } from '../src/deps.js';
import { prisma } from '../src/lib/prisma.js';
import { BCRYPT_ROUNDS } from '../src/modules/auth/routes.js';
import { createEnvironment } from '../src/modules/apps/service.js';
import type { SimulatorConfig } from '../src/modules/delivery/channels.js';
import { dispatchContextOf, dispatchMessage } from '../src/modules/delivery/dispatcher.js';
import { recordSimulatedEvents } from '../src/modules/messages/events.js';
import { generateMsgid } from '../src/modules/messages/service.js';

const TIMEZONE = 'Asia/Shanghai';
const HISTORY_DAYS = 45;

const SIMULATOR: SimulatorConfig = {
  fcm: { mode: 'success', failureRate: 0.18 },
  xiaomi: { mode: 'success', failureRate: 0.1 },
  huawei: { mode: 'success', failureRate: 0.12 },
  mtpush: { mode: 'success', failureRate: 0.04 },
  apns: { mode: 'success', failureRate: 0.05 },
};

const DEVICE_MIX = [
  { platform: 'ANDROID', vendor: 'xiaomi', model: 'Redmi Note 13', osVersion: '14' },
  { platform: 'ANDROID', vendor: 'huawei', model: 'Mate 60', osVersion: '12' },
  { platform: 'ANDROID', vendor: 'oppo', model: 'Reno 12', osVersion: '14' },
  { platform: 'ANDROID', vendor: 'vivo', model: 'X100', osVersion: '14' },
  { platform: 'ANDROID', vendor: 'honor', model: 'Magic 6', osVersion: '14' },
  { platform: 'ANDROID', vendor: 'samsung', model: 'Galaxy S24', osVersion: '15' },
  { platform: 'IOS', vendor: 'apple', model: 'iPhone 15', osVersion: '18.1' },
  { platform: 'IOS', vendor: 'apple', model: 'iPhone 14', osVersion: '17.6' },
  { platform: 'HARMONYOS', vendor: 'huawei', model: 'Pura 70', osVersion: '5.0' },
] as const;

const APP_VERSIONS = ['2.3.0', '2.2.1', '2.1.0'];
const TAGS = ['vip', 'beta', 'newsletter', 'sale-alerts'];
const MESSAGES = [
  { type: 'NOTIFICATION', title: 'Weekend flash sale', body: 'Up to 40% off until Sunday.' },
  { type: 'NOTIFICATION', title: 'Your order has shipped', body: 'Track it in the app.' },
  { type: 'IN_APP', title: 'New feature', body: 'Saved searches are here.' },
  { type: 'CUSTOM', title: null, body: null },
] as const;
const STRATEGIES = ['fcm_mtpush', 'pns_mtpush', 'mtpush', 'mtpush_fcm', 'mtpush_pns'] as const;

async function removePreviousDemoData() {
  const apps = await prisma.application.findMany({
    where: { name: { startsWith: '[Demo]' } },
    select: { id: true },
  });
  const applicationId = { in: apps.map((a) => a.id) };
  await prisma.appEnvironment.deleteMany({ where: { applicationId } });
  await prisma.application.deleteMany({ where: { id: applicationId } });
}

async function createDevices(environmentId: number, prefix: string, count: number, now: Date) {
  const tags = await Promise.all(
    TAGS.map((name) => prisma.tag.create({ data: { environmentId, name } })),
  );
  for (let i = 0; i < count; i += 1) {
    const mix = DEVICE_MIX[i % DEVICE_MIX.length]!;
    const alias =
      i % 7 === 0
        ? await prisma.alias.create({ data: { environmentId, name: `${prefix}-user-${i}` } })
        : null;
    await prisma.device.create({
      data: {
        ...mix,
        environmentId,
        registrationId: `${prefix}_${String(i).padStart(4, '0')}_${environmentId}`,
        appVersion: APP_VERSIONS[i % APP_VERSIONS.length]!,
        online: i % 5 !== 0,
        notificationsEnabled: i % 6 !== 0,
        lastActiveAt: new Date(now.getTime() - (i % 20) * 86_400_000),
        aliasId: alias?.id ?? null,
        status: i % 23 === 22 ? 'INACTIVE' : 'ACTIVE',
        // Stays inside the testing limit of ten devices per tag.
        tags: i < 8 ? { create: [{ tagId: tags[i % TAGS.length]!.id }] } : undefined,
      },
    });
  }
}

async function createHistory(environment: { id: number; enabledChannels: unknown; simulatorConfig: unknown }) {
  const today = DateTime.now().setZone(TIMEZONE).startOf('day');
  let sequence = 0;

  for (let day = HISTORY_DAYS; day >= 1; day -= 1) {
    const messagesToday = day % 3 === 0 ? 2 : 1;
    for (let i = 0; i < messagesToday; i += 1) {
      sequence += 1;
      const template = MESSAGES[sequence % MESSAGES.length]!;
      const at = today.minus({ days: day }).plus({ hours: 9 + i * 5 }).toJSDate();
      const clock = () => at;
      const deps = createDeps({ clock });
      const message = await prisma.pushMessage.create({
        data: {
          msgid: generateMsgid(at),
          environmentId: environment.id,
          type: template.type,
          title: template.title,
          body: template.body,
          customPayload: template.type === 'CUSTOM' ? { action: 'refresh', version: sequence } : undefined,
          platforms: sequence % 4 === 0 ? ['ANDROID'] : ['ANDROID', 'IOS', 'HARMONYOS'],
          audienceType: 'ALL',
          audience: [],
          strategy: STRATEGIES[sequence % STRATEGIES.length]!,
          requestHash: `seed-${sequence}`,
          createdAt: at,
        },
      });
      await dispatchMessage(deps, message.id, dispatchContextOf(environment));

      const delivered = await prisma.messageTarget.count({
        where: { messageId: message.id, status: 'DELIVERED' },
      });
      const shown = Math.floor(delivered * (0.6 + (sequence % 4) * 0.08));
      if (shown > 0) {
        await recordSimulatedEvents(message.id, { type: 'DISPLAYED', count: shown }, at);
      }
      const clicked = Math.floor(shown * (0.2 + (sequence % 3) * 0.08));
      if (clicked > 0) {
        await recordSimulatedEvents(message.id, { type: 'CLICKED', count: clicked }, at);
      }
    }
  }
}

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed a production deployment');
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env');

  await prisma.adminUser.upsert({
    where: { email },
    create: {
      email,
      name: 'Demo Admin',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    },
    update: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS), isActive: true },
  });

  await removePreviousDemoData();
  const now = new Date();

  const shop = await prisma.application.create({
    data: {
      name: '[Demo] ShopNow',
      description: 'E-commerce demo application',
      isVip: true,
      serviceValidUntil: DateTime.fromJSDate(now).plus({ years: 1 }).toJSDate(),
      timezone: TIMEZONE,
    },
  });
  const blog = await prisma.application.create({
    data: {
      name: '[Demo] DailyNews',
      description: 'News demo application, no testing environment yet',
      timezone: TIMEZONE,
    },
  });

  const { production, testing } = await prisma.$transaction(async (tx) => ({
    production: (await createEnvironment(tx, shop.id, 'PRODUCTION')).environment,
    testing: (await createEnvironment(tx, shop.id, 'TESTING')).environment,
  }));
  const news = await prisma.$transaction((tx) => createEnvironment(tx, blog.id, 'PRODUCTION'));

  const configured = await prisma.appEnvironment.update({
    where: { id: production.id },
    data: { simulatorConfig: SIMULATOR },
  });

  await createDevices(production.id, 'prod', 60, now);
  await createDevices(testing.id, 'test', 12, now);
  await createDevices(news.environment.id, 'news', 15, now);
  await createHistory(configured);

  // One pending job so that the Scheduled page has something to show.
  const runAt = DateTime.fromJSDate(now).plus({ days: 1 }).toJSDate();
  await prisma.pushMessage.create({
    data: {
      msgid: generateMsgid(now),
      environmentId: production.id,
      type: 'NOTIFICATION',
      title: 'Tomorrow: members-only preview',
      body: 'Early access opens at the scheduled time.',
      platforms: ['ANDROID', 'IOS'],
      audienceType: 'TAGS',
      audience: ['vip'],
      strategy: 'pns_mtpush',
      scheduleType: 'SCHEDULED',
      scheduledAt: runAt,
      requestHash: 'seed-scheduled',
      job: { create: { runAt, maxAttempts: env.WORKER_MAX_ATTEMPTS } },
    },
  });

  const counts = {
    applications: await prisma.application.count(),
    devices: await prisma.device.count(),
    messages: await prisma.pushMessage.count(),
    attempts: await prisma.deliveryAttempt.count(),
    events: await prisma.messageEvent.count(),
  };
  console.log('Seed complete.', counts);
  console.log(`Admin login: ${email} (password is SEED_ADMIN_PASSWORD in backend/.env)`);
  console.log('Demo Master Secrets are not displayed. Rotate one in the console to obtain it.');
}

await main().finally(() => prisma.$disconnect());
