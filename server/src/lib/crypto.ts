import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getEncryptionKeyHex } from './secrets.js';

// key must be 64 hex chars (32 bytes)
export function encrypt(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
}

// Returns the 32-byte (64 hex char) key used to encrypt stored connection
// secrets (API keys, MCP credentials). Resolution (env ENCRYPTION_KEY →
// SHA-256(JWT_SECRET) for backward compatibility → generated-and-persisted key)
// lives in the secrets module.
export function deriveKey(): string {
  return getEncryptionKeyHex();
}
