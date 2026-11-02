import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/errors.js';
import {
  assertDeviceCapacity,
  assertDeviceHasRoom,
  assertTagCapacity,
  assertTagHasRoom,
  TESTING_LIMITS,
} from '../../src/modules/limits.js';

const code = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    return (error as ApiError).code;
  }
  return null;
};

describe('testing environment limits', () => {
  it('has the limits from the specification', () => {
    expect(TESTING_LIMITS).toEqual({
      maxDevices: 1000,
      maxTags: 50,
      maxDevicesPerTag: 10,
      maxTagsPerDevice: 10,
    });
  });

  it.each([
    ['devices', assertDeviceCapacity, 1000, 'TESTING_DEVICE_LIMIT'],
    ['tags', assertTagCapacity, 50, 'TESTING_TAG_LIMIT'],
    ['devices per tag', assertTagHasRoom, 10, 'TESTING_DEVICES_PER_TAG_LIMIT'],
    ['tags per device', assertDeviceHasRoom, 10, 'TESTING_TAGS_PER_DEVICE_LIMIT'],
  ] as const)('enforces %s at the boundary', (_name, assert, limit, expected) => {
    expect(code(() => assert('TESTING', limit - 1))).toBeNull();
    expect(code(() => assert('TESTING', limit))).toBe(expected);
    expect(code(() => assert('TESTING', limit + 1))).toBe(expected);
  });

  it('does not limit production environments', () => {
    expect(code(() => assertDeviceCapacity('PRODUCTION', 1_000_000))).toBeNull();
    expect(code(() => assertTagCapacity('PRODUCTION', 1_000_000))).toBeNull();
    expect(code(() => assertTagHasRoom('PRODUCTION', 1_000_000))).toBeNull();
    expect(code(() => assertDeviceHasRoom('PRODUCTION', 1_000_000))).toBeNull();
  });

  it('reports limits as a 409 with details', () => {
    try {
      assertTagCapacity('TESTING', 50);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).details).toEqual({ limit: 50, current: 50 });
    }
  });
});
