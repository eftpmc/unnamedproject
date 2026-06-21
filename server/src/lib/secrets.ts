import { randomBytes, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../db/index.js';

// Resolves the two secrets the server needs — the JWT signing secret and the
// data-encryption key — with this precedence:
//
//   1. Environment variable (explicit; wins, supports rotation / external mgmt)
//   2. Persisted secrets file in DATA_DIR (auto-generated on a prior run)
//   3. Freshly generated, then persisted to that file
//
// This gives self-hosters a secure zero-config first run: they don't have to
// hand-generate secrets, and a missing secret no longer silently degrades to a
// public constant. Secrets live alongside the database in DATA_DIR, which is
// already as trusted as the data itself.

interface PersistedSecrets {
  jwtSecret?: string;
  encryptionKey?: string;
}

export type SecretSource = 'env' | 'file' | 'generated' | 'ephemeral';

const cache: PersistedSecrets = {};
const sources: Record<keyof PersistedSecrets, SecretSource | undefined> = {
  jwtSecret: undefined,
  encryptionKey: undefined,
};

function secretsPath(): string {
  return path.join(getDataDir(), 'secrets.json');
}

function load(): PersistedSecrets {
  try {
    return JSON.parse(fs.readFileSync(secretsPath(), 'utf8')) as PersistedSecrets;
  } catch {
    return {};
  }
}

/** Persists secrets with owner-only permissions. Returns whether it succeeded. */
function persist(next: PersistedSecrets): boolean {
  try {
    const p = secretsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2), { mode: 0o600 });
    try { fs.chmodSync(p, 0o600); } catch { /* tighten perms best-effort */ }
    return true;
  } catch {
    return false;
  }
}

function generateAndStore(field: keyof PersistedSecrets, envName: string): string {
  const value = randomBytes(32).toString('hex');
  const persisted = persist({ ...load(), [field]: value });
  if (!persisted && process.env.NODE_ENV === 'production') {
    throw new Error(
      `Could not persist a generated ${field} to ${secretsPath()}. ` +
      `Set ${envName} in the environment or make DATA_DIR writable.`,
    );
  }
  sources[field] = persisted ? 'generated' : 'ephemeral';
  cache[field] = value;
  return value;
}

export function getJwtSecret(): string {
  if (process.env.JWT_SECRET) { sources.jwtSecret = 'env'; return process.env.JWT_SECRET; }
  if (cache.jwtSecret) return cache.jwtSecret;
  const file = load();
  if (file.jwtSecret) { sources.jwtSecret = 'file'; cache.jwtSecret = file.jwtSecret; return file.jwtSecret; }
  return generateAndStore('jwtSecret', 'JWT_SECRET');
}

export function getEncryptionKeyHex(): string {
  const explicit = process.env.ENCRYPTION_KEY;
  if (explicit) {
    if (!/^[0-9a-fA-F]{64}$/.test(explicit)) {
      throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    sources.encryptionKey = 'env';
    return explicit.toLowerCase();
  }
  // Backward compatibility: deployments that set only JWT_SECRET had their
  // stored secrets encrypted under SHA-256(JWT_SECRET). Preserve that derivation
  // so existing connection data keeps decrypting.
  if (process.env.JWT_SECRET) {
    sources.encryptionKey = 'env';
    return createHash('sha256').update(process.env.JWT_SECRET).digest('hex');
  }
  if (cache.encryptionKey) return cache.encryptionKey;
  const file = load();
  if (file.encryptionKey) { sources.encryptionKey = 'file'; cache.encryptionKey = file.encryptionKey; return file.encryptionKey; }
  return generateAndStore('encryptionKey', 'ENCRYPTION_KEY');
}

/** Resolves both secrets (generating/persisting if needed). Call once at boot. */
export function ensureSecrets(): void {
  getJwtSecret();
  getEncryptionKeyHex();
}

export function getSecretSources(): Record<keyof PersistedSecrets, SecretSource | undefined> {
  return { ...sources };
}

/** Test-only: clears the in-memory cache and recorded sources. */
export function _resetSecretsForTests(): void {
  cache.jwtSecret = undefined;
  cache.encryptionKey = undefined;
  sources.jwtSecret = undefined;
  sources.encryptionKey = undefined;
}
