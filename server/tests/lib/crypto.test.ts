import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { encrypt, decrypt, deriveKey } from '../../src/lib/crypto.js';

describe('crypto', () => {
  it('roundtrips plaintext through encrypt/decrypt', () => {
    const key = '0'.repeat(64);
    const plain = JSON.stringify({ apiKey: 'sk-test-123' });
    const ciphertext = encrypt(plain, key);
    expect(ciphertext).not.toBe(plain);
    expect(decrypt(ciphertext, key)).toBe(plain);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const key = '0'.repeat(64);
    const plain = 'same-plaintext';
    expect(encrypt(plain, key)).not.toBe(encrypt(plain, key));
  });
});

describe('deriveKey', () => {
  const orig = {
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  afterEach(() => {
    process.env.ENCRYPTION_KEY = orig.ENCRYPTION_KEY;
    process.env.JWT_SECRET = orig.JWT_SECRET;
    process.env.NODE_ENV = orig.NODE_ENV;
  });

  it('prefers ENCRYPTION_KEY when set', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    expect(deriveKey()).toBe('a'.repeat(64));
  });

  it('rejects a malformed ENCRYPTION_KEY', () => {
    process.env.ENCRYPTION_KEY = 'too-short';
    expect(() => deriveKey()).toThrow(/64 hex/);
  });

  it('derives from JWT_SECRET when ENCRYPTION_KEY is unset (backward compatible)', () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'some-secret';
    expect(deriveKey()).toBe(createHash('sha256').update('some-secret').digest('hex'));
  });
});
