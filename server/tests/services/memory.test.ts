import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { rememberFact, recallFact, recallAll } from '../../src/services/memory.js';
import { newId } from '../../src/lib/ids.js';

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `mem-${userId}@test.com`, 'x');
});

describe('memory', () => {
  it('stores and recalls a fact', () => {
    rememberFact(userId, 'preferred_model', 'claude-opus-4-8');
    expect(recallFact(userId, 'preferred_model')).toBe('claude-opus-4-8');
  });

  it('updates an existing key', () => {
    rememberFact(userId, 'preferred_model', 'claude-sonnet-4-6');
    expect(recallFact(userId, 'preferred_model')).toBe('claude-sonnet-4-6');
  });

  it('returns null for missing key', () => {
    expect(recallFact(userId, 'nonexistent')).toBeNull();
  });

  it('returns all facts for a user', () => {
    rememberFact(userId, 'timezone', 'America/New_York');
    const all = recallAll(userId);
    expect(all).toHaveProperty('preferred_model');
    expect(all).toHaveProperty('timezone');
  });
});
