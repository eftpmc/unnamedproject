import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { remember, recall, forget } from '../../src/tools/memory_tools.js';
import { newId } from '../../src/lib/ids.js';

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `memtools-${userId}@test.com`, 'x');
});

describe('memory_tools', () => {
  it('remember stores a typed entry and recall reads it back', () => {
    const result = remember(userId, 'user', 'timezone', 'PST');
    expect(result).toBe('Remembered [user] timezone: PST');
    expect(recall(userId, 'user', 'timezone')).toBe('[user] timezone: PST');
  });

  it('remember rejects an invalid type', () => {
    const result = remember(userId, 'bogus', 'key', 'value');
    expect(result).toContain('invalid memory type');
  });

  it('recall with no args returns all entries grouped by type', () => {
    remember(userId, 'feedback', 'package_manager', 'use pnpm, not npm');
    const result = recall(userId);
    expect(result).toContain('[user] timezone: PST');
    expect(result).toContain('[feedback] package_manager: use pnpm, not npm');
  });

  it('recall with only type filters by category', () => {
    const result = recall(userId, 'feedback');
    expect(result).toContain('[feedback] package_manager: use pnpm, not npm');
    expect(result).not.toContain('[user] timezone');
  });

  it('recall for a missing key reports no memory', () => {
    expect(recall(userId, 'user', 'nonexistent')).toBe('No memory for [user] nonexistent');
  });

  it('recall with no entries reports the empty state', () => {
    const emptyUserId = newId();
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(emptyUserId, `memtools-empty-${emptyUserId}@test.com`, 'x');
    expect(recall(emptyUserId)).toBe('No memories stored yet.');
  });

  it('forget removes an entry', () => {
    remember(userId, 'user', 'temp', 'value');
    expect(forget(userId, 'user', 'temp')).toBe('Forgot [user] temp');
    expect(recall(userId, 'user', 'temp')).toBe('No memory for [user] temp');
  });

  it('forget on a missing entry reports no memory', () => {
    expect(forget(userId, 'user', 'never_existed')).toBe('No memory for [user] never_existed');
  });

  it('formats project entries with the linked project name', () => {
    const projectId = newId();
    getDb().prepare('INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)')
      .run(projectId, userId, 'demo-project', '[]');
    remember(userId, 'project', 'status', 'in progress', projectId);
    expect(recall(userId, 'project', 'status')).toBe('[project: demo-project] status: in progress');
  });
});
