import type { EnvironmentType } from '@prisma/client';
import { conflict } from '../lib/errors.js';

export const TESTING_LIMITS = {
  maxDevices: 1000,
  maxTags: 50,
  maxDevicesPerTag: 10,
  maxTagsPerDevice: 10,
} as const;

function assertBelow(
  type: EnvironmentType,
  current: number,
  limit: number,
  code: string,
  message: string,
) {
  if (type === 'TESTING' && current >= limit) {
    throw conflict(code, message, { limit, current });
  }
}

export const assertDeviceCapacity = (type: EnvironmentType, deviceCount: number) =>
  assertBelow(
    type,
    deviceCount,
    TESTING_LIMITS.maxDevices,
    'TESTING_DEVICE_LIMIT',
    `Testing environments allow at most ${TESTING_LIMITS.maxDevices} devices`,
  );

export const assertTagCapacity = (type: EnvironmentType, tagCount: number) =>
  assertBelow(
    type,
    tagCount,
    TESTING_LIMITS.maxTags,
    'TESTING_TAG_LIMIT',
    `Testing environments allow at most ${TESTING_LIMITS.maxTags} tags`,
  );

export const assertTagHasRoom = (type: EnvironmentType, devicesOnTag: number) =>
  assertBelow(
    type,
    devicesOnTag,
    TESTING_LIMITS.maxDevicesPerTag,
    'TESTING_DEVICES_PER_TAG_LIMIT',
    `Testing environments allow at most ${TESTING_LIMITS.maxDevicesPerTag} devices per tag`,
  );

export const assertDeviceHasRoom = (type: EnvironmentType, tagsOnDevice: number) =>
  assertBelow(
    type,
    tagsOnDevice,
    TESTING_LIMITS.maxTagsPerDevice,
    'TESTING_TAGS_PER_DEVICE_LIMIT',
    `Testing environments allow at most ${TESTING_LIMITS.maxTagsPerDevice} tags per device`,
  );
