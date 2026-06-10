import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../src/lib/crypto.js';

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
