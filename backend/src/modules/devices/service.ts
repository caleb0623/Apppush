import type { AppEnvironment } from '@prisma/client';
import { conflict, notFound } from '../../lib/errors.js';
import { prisma, lockEnvironment, type Tx } from '../../lib/prisma.js';
import {
  assertDeviceCapacity,
  assertDeviceHasRoom,
  assertTagCapacity,
  assertTagHasRoom,
} from '../limits.js';

export async function findDevice(environmentId: number, registrationId: string, tx: Tx = prisma) {
  const device = await tx.device.findFirst({ where: { registrationId, environmentId } });
  if (!device) throw notFound('Device');
  return device;
}

export async function createDevice<T>(
  environment: AppEnvironment,
  create: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockEnvironment(tx, environment.id);
    const count = await tx.device.count({ where: { environmentId: environment.id } });
    assertDeviceCapacity(environment.type, count);
    return create(tx);
  });
}

async function findOrCreateTag(tx: Tx, environment: AppEnvironment, name: string) {
  const existing = await tx.tag.findUnique({
    where: { environmentId_name: { environmentId: environment.id, name } },
  });
  if (existing) return existing;
  assertTagCapacity(
    environment.type,
    await tx.tag.count({ where: { environmentId: environment.id } }),
  );
  return tx.tag.create({ data: { environmentId: environment.id, name } });
}

/** Must run in a transaction that already holds the environment lock. */
async function assign(tx: Tx, environment: AppEnvironment, deviceId: number, tagId: number) {
  const key = { deviceId_tagId: { deviceId, tagId } };
  if (await tx.deviceTag.findUnique({ where: key })) return;
  assertTagHasRoom(environment.type, await tx.deviceTag.count({ where: { tagId } }));
  assertDeviceHasRoom(environment.type, await tx.deviceTag.count({ where: { deviceId } }));
  await tx.deviceTag.create({ data: { deviceId, tagId } });
}

export async function updateDeviceTags(
  environment: AppEnvironment,
  registrationId: string,
  add: string[],
  remove: string[],
) {
  await prisma.$transaction(async (tx) => {
    await lockEnvironment(tx, environment.id);
    const device = await findDevice(environment.id, registrationId, tx);
    await tx.deviceTag.deleteMany({
      where: { deviceId: device.id, tag: { name: { in: remove } } },
    });
    for (const name of add) {
      const tag = await findOrCreateTag(tx, environment, name);
      await assign(tx, environment, device.id, tag.id);
    }
  });
}

export async function createTag(environment: AppEnvironment, name: string) {
  return prisma.$transaction(async (tx) => {
    await lockEnvironment(tx, environment.id);
    const existing = await tx.tag.findUnique({
      where: { environmentId_name: { environmentId: environment.id, name } },
    });
    if (existing) throw conflict('TAG_EXISTS', `Tag "${name}" already exists`);
    return findOrCreateTag(tx, environment, name);
  });
}

export async function updateTagDevices(
  environment: AppEnvironment,
  name: string,
  add: string[],
  remove: string[],
) {
  await prisma.$transaction(async (tx) => {
    await lockEnvironment(tx, environment.id);
    const tag = await tx.tag.findUnique({
      where: { environmentId_name: { environmentId: environment.id, name } },
    });
    if (!tag) throw notFound('Tag');
    await tx.deviceTag.deleteMany({
      where: { tagId: tag.id, device: { registrationId: { in: remove } } },
    });
    for (const registrationId of add) {
      const device = await findDevice(environment.id, registrationId, tx);
      await assign(tx, environment, device.id, tag.id);
    }
  });
}

export async function setDeviceAlias(
  environment: AppEnvironment,
  registrationId: string,
  alias: string | null,
) {
  const device = await findDevice(environment.id, registrationId);
  await prisma.$transaction(async (tx) => {
    const record = alias
      ? await tx.alias.upsert({
          where: { environmentId_name: { environmentId: environment.id, name: alias } },
          create: { environmentId: environment.id, name: alias },
          update: {},
        })
      : null;
    await tx.device.update({ where: { id: device.id }, data: { aliasId: record?.id ?? null } });
  });
}
