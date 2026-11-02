import { describe, expect, it } from 'vitest';
import {
  generateAppKey,
  generateMasterSecret,
  hashMasterSecret,
  issueCredential,
  secretHint,
  verifyMasterSecret,
} from '../../src/lib/credentials.js';

describe('credentials', () => {
  it('generates 24-character hex AppKeys that do not repeat', () => {
    const keys = new Set(Array.from({ length: 500 }, generateAppKey));
    expect(keys.size).toBe(500);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{24}$/);
  });

  it('generates URL-safe secrets with 256 bits of entropy', () => {
    const secret = generateMasterSecret();
    expect(secret).toMatch(/^[\w-]{43}$/);
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
  });

  it('stores a one-way hash that does not contain the secret', () => {
    const { masterSecret, record } = issueCredential();
    expect(record.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.secretHash).not.toContain(masterSecret);
    expect(JSON.stringify(record)).not.toContain(masterSecret);
  });

  it('verifies only the matching secret', () => {
    const { masterSecret, record } = issueCredential();
    expect(verifyMasterSecret(masterSecret, record.secretHash)).toBe(true);
    expect(verifyMasterSecret(`${masterSecret}x`, record.secretHash)).toBe(false);
    expect(verifyMasterSecret(generateMasterSecret(), record.secretHash)).toBe(false);
  });

  it('hashes deterministically, so verification needs no stored salt', () => {
    expect(hashMasterSecret('abc')).toBe(hashMasterSecret('abc'));
  });

  it('exposes only the last four characters as a hint', () => {
    expect(secretHint('abcdefghij')).toBe('...ghij');
  });
});
