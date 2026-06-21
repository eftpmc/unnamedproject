import { describe, it, expect, beforeAll } from 'vitest';
import { getDataDir, getDb, initDb } from '../src/db/index.js';
import fs from 'fs';
import path from 'path';

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
    // campaigns/campaign_tasks were renamed to plans/plan_steps.
    expect(names).toContain('plans');
    expect(names).toContain('plan_steps');
    expect(names).not.toContain('campaigns');
  });

  it('stamps the schema version after migrating', () => {
    const version = getDb().pragma('user_version', { simple: true }) as number;
    expect(version).toBeGreaterThanOrEqual(1);
  });

  it('has no foreign keys dangling at the dropped campaign tables', () => {
    const db = getDb();
    for (const name of ['plan_steps', 'artifacts', 'session_events']) {
      const sql = (db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
        .get(name) as { sql: string } | undefined)?.sql ?? '';
      expect(sql, `${name} references a dropped table`).not.toMatch(/REFERENCES\s+campaigns?\b|campaign_tasks/);
    }
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

  it('resolves DATA_DIR to an absolute path', () => {
    expect(path.isAbsolute(getDataDir())).toBe(true);
  });
});
