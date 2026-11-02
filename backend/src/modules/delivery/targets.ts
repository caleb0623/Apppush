import type { Device, Platform, Prisma, PushMessage } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

type DeviceFacts = Pick<
  Device,
  | 'id'
  | 'registrationId'
  | 'platform'
  | 'vendor'
  | 'appVersion'
  | 'online'
  | 'status'
  | 'installationId'
  | 'pushToken'
  | 'pushTokenStatus'
>;

const deviceFields = {
  id: true,
  registrationId: true,
  platform: true,
  vendor: true,
  appVersion: true,
  online: true,
  status: true,
  installationId: true,
  pushToken: true,
  pushTokenStatus: true,
} as const;

/** Only the client app supplies an installation ID, so anything else is a simulated record. */
export const isRealDevice = (device: Pick<Device, 'installationId'>) =>
  device.installationId !== null;

export function classifyDevice(device: DeviceFacts, platforms: readonly Platform[]) {
  if (device.status !== 'ACTIVE') return 'DEVICE_INACTIVE';
  if (!platforms.includes(device.platform)) return 'PLATFORM_MISMATCH';
  if (isRealDevice(device)) {
    if (!device.pushToken) return 'NO_PUSH_TOKEN';
    if (device.pushTokenStatus === 'INVALID') return 'PUSH_TOKEN_INVALID';
  }
  return null;
}

const targetFor = (
  messageId: number,
  device: DeviceFacts,
  platforms: readonly Platform[],
): Prisma.MessageTargetCreateManyInput => {
  const invalidReason = classifyDevice(device, platforms);
  return {
    messageId,
    deviceId: device.id,
    registrationId: device.registrationId,
    platform: device.platform,
    vendor: device.vendor,
    appVersion: device.appVersion,
    online: device.online,
    deliveryMode: isRealDevice(device) ? 'REAL' : 'SIMULATED',
    isValid: invalidReason === null,
    invalidReason,
    status: invalidReason === null ? 'PENDING' : 'INVALID',
  };
};

const unresolved = (
  messageId: number,
  registrationId: string,
  invalidReason: string,
): Prisma.MessageTargetCreateManyInput => ({
  messageId,
  registrationId,
  isValid: false,
  invalidReason,
  status: 'INVALID',
});

async function findAudience(message: PushMessage) {
  const environmentId = message.environmentId;
  const values = message.audience as string[];
  const found: DeviceFacts[] = [];
  const missing: { key: string; reason: string }[] = [];

  switch (message.audienceType) {
    case 'ALL':
      found.push(
        ...(await prisma.device.findMany({ where: { environmentId }, select: deviceFields })),
      );
      break;
    case 'REGISTRATION_IDS': {
      const devices = await prisma.device.findMany({
        where: { environmentId, registrationId: { in: values } },
        select: deviceFields,
      });
      const known = new Set(devices.map((d) => d.registrationId));
      found.push(...devices);
      missing.push(
        ...values
          .filter((value) => !known.has(value))
          .map((key) => ({ key, reason: 'DEVICE_NOT_FOUND' })),
      );
      break;
    }
    case 'TAGS': {
      const tags = await prisma.tag.findMany({
        where: { environmentId, name: { in: values } },
        select: { name: true },
      });
      const known = new Set(tags.map((t) => t.name));
      found.push(
        ...(await prisma.device.findMany({
          where: { environmentId, tags: { some: { tag: { name: { in: [...known] } } } } },
          select: deviceFields,
        })),
      );
      missing.push(
        ...values
          .filter((value) => !known.has(value))
          .map((value) => ({ key: `tag:${value}`, reason: 'UNKNOWN_TAG' })),
      );
      break;
    }
    case 'ALIASES': {
      const aliases = await prisma.alias.findMany({
        where: { environmentId, name: { in: values } },
        select: { name: true },
      });
      const known = new Set(aliases.map((a) => a.name));
      found.push(
        ...(await prisma.device.findMany({
          where: { environmentId, alias: { name: { in: [...known] } } },
          select: deviceFields,
        })),
      );
      missing.push(
        ...values
          .filter((value) => !known.has(value))
          .map((value) => ({ key: `alias:${value}`, reason: 'UNKNOWN_ALIAS' })),
      );
      break;
    }
  }
  return { found, missing };
}

/**
 * Creates target rows once. `skipDuplicates` plus the (messageId, registrationId)
 * key makes this safe to re-run when a job is retried, and a device reached
 * through two tags still gets one row.
 */
export async function materializeTargets(message: PushMessage): Promise<void> {
  if ((await prisma.messageTarget.count({ where: { messageId: message.id } })) > 0) return;
  const { found, missing } = await findAudience(message);
  const platforms = message.platforms as Platform[];
  const rows = [
    ...found.map((device) => targetFor(message.id, device, platforms)),
    ...missing.map(({ key, reason }) => unresolved(message.id, key, reason)),
  ];
  if (rows.length > 0) {
    await prisma.messageTarget.createMany({ data: rows, skipDuplicates: true });
  }
}
