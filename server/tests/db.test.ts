import { describe, it, expect, beforeAll } from 'vitest';
import { getDb, initDb } from '../src/db/index.js';
import fs from 'fs';

describe('database schema', () => {
  beforeAll(() => {
    fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
    initDb();
  });

  it('creates all tables', () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('users');
    expect(names).toContain('connections');
    expect(names).toContain('workspaces');
    expect(names).toContain('threads');
    expect(names).toContain('messages');
    expect(names).toContain('executions');
    expect(names).toContain('approvals');
    expect(names).toContain('user_memory');
  });
});
