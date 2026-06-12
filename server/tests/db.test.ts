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
    expect(names).toContain('projects');
    expect(names).toContain('user_settings');
    expect(names).toContain('sessions');
    expect(names).toContain('messages');
    expect(names).toContain('executions');
    expect(names).toContain('approvals');
    expect(names).toContain('memories');
    expect(names).toContain('scheduled_tasks');
    expect(names).toContain('campaigns');
    expect(names).toContain('campaign_tasks');
  });

  it('executions table has project_id column', () => {
    const db = getDb();
    const cols = db.prepare("SELECT name FROM pragma_table_info('executions')").all() as { name: string }[];
    expect(cols.some(c => c.name === 'project_id')).toBe(true);
  });

  it('sessions table has a summary column', () => {
    const cols = getDb()
      .prepare("SELECT name FROM pragma_table_info('sessions')")
      .all() as { name: string }[];
    expect(cols.some(c => c.name === 'summary')).toBe(true);
  });
});
