import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import {
  getJwtSecret,
  getEncryptionKeyHex,
  getSecretSources,
  _resetSecretsForTests,
} from '../../src/lib/secrets.js';

const ORIG = {
  JWT_SECRET: process.env.JWT_SECRET,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  DATA_DIR: process.env.DATA_DIR,
};

function restore(key: keyof typeof ORIG) {
  const v = ORIG[key];
  if (v === undefined) delete process.env[key];
  else process.env[key] = v;
}

describe('secrets', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
    process.env.DATA_DIR = dir;
    delete process.env.JWT_SECRET;
    delete process.env.ENCRYPTION_KEY;
    _resetSecretsForTests();
  });

  afterEach(() => {
    restore('JWT_SECRET');
    restore('ENCRYPTION_KEY');
    restore('DATA_DIR');
    _resetSecretsForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses JWT_SECRET from the environment when set', () => {
    process.env.JWT_SECRET = 'env-provided';
    expect(getJwtSecret()).toBe('env-provided');
    expect(getSecretSources().jwtSecret).toBe('env');
    expect(fs.existsSync(path.join(dir, 'secrets.json'))).toBe(false);
  });

  it('prefers a valid ENCRYPTION_KEY from the environment', () => {
    process.env.ENCRYPTION_KEY = 'A'.repeat(64);
    expect(getEncryptionKeyHex()).toBe('a'.repeat(64));
    expect(getSecretSources().encryptionKey).toBe('env');
  });

  it('rejects a malformed ENCRYPTION_KEY', () => {
    process.env.ENCRYPTION_KEY = 'nope';
    expect(() => getEncryptionKeyHex()).toThrow(/64 hex/);
  });

  it('derives the encryption key from JWT_SECRET for backward compatibility', () => {
    process.env.JWT_SECRET = 'legacy-secret';
    expect(getEncryptionKeyHex()).toBe(createHash('sha256').update('legacy-secret').digest('hex'));
  });

  it('generates and persists a JWT secret on first run, then reads it back', () => {
    const generated = getJwtSecret();
    expect(generated).toMatch(/^[0-9a-f]{64}$/);
    expect(getSecretSources().jwtSecret).toBe('generated');

    const file = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
    expect(file.jwtSecret).toBe(generated);

    // A fresh process (cache cleared) loads the same value from the file.
    _resetSecretsForTests();
    expect(getJwtSecret()).toBe(generated);
    expect(getSecretSources().jwtSecret).toBe('file');
  });

  it('generates a standalone encryption key when neither env var is set', () => {
    const key = getEncryptionKeyHex();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(getSecretSources().encryptionKey).toBe('generated');
    // Independent of the JWT secret, not a derivation of it.
    expect(key).not.toBe(createHash('sha256').update(getJwtSecret()).digest('hex'));
  });
});
