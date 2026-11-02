import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/** 24 hex characters, the same shape as AppKeys issued by the real platform. */
export const generateAppKey = (): string => randomBytes(12).toString('hex');

/** 256 bits of randomness, URL-safe. */
export const generateMasterSecret = (): string => randomBytes(32).toString('base64url');

/**
 * Keyed one-way hash. A slow password hash is unnecessary here: the input has
 * 256 bits of entropy, so it cannot be brute-forced, and this runs on every API call.
 */
export const hashMasterSecret = (secret: string): string =>
  createHmac('sha256', env.CREDENTIAL_PEPPER).update(secret).digest('hex');

export function verifyMasterSecret(secret: string, storedHash: string): boolean {
  const actual = Buffer.from(hashMasterSecret(secret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A device's own credential for the client API, issued once at registration. */
export const generateDeviceSecret = (): string => randomBytes(32).toString('base64url');

/** The prefix keeps device and Master Secret hashes from ever being interchangeable. */
export const hashDeviceSecret = (secret: string): string =>
  createHmac('sha256', env.CREDENTIAL_PEPPER).update(`device:${secret}`).digest('hex');

export function verifyDeviceSecret(secret: string, storedHash: string): boolean {
  const actual = Buffer.from(hashDeviceSecret(secret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Lets an operator recognise a credential without revealing it. */
export const secretHint = (secret: string): string => `...${secret.slice(-4)}`;

export const issueCredential = () => {
  const masterSecret = generateMasterSecret();
  return {
    masterSecret,
    record: { secretHash: hashMasterSecret(masterSecret), secretHint: secretHint(masterSecret) },
  };
};
