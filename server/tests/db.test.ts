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
    expect(names).toContain('spaces');
    expect(names).toContain('user_settings');
    expect(names).toContain('sessions');
    expect(names).toContain('messages');
    expect(names).toContain('executions');
    expect(names).toContain('approvals');
    expect(names).toContain('memories');
    expect(names).not.toContain('scheduled_tasks');
    // plans/plan_steps have been dropped — the ConversationProvider handles orchestration.
    expect(names).not.toContain('plans');
    expect(names).not.toContain('plan_steps');
    expect(names).not.toContain('campaigns');
    // new tables from baseline refactor
    expect(names).toContain('projects');
    expect(names).toContain('documents');
    expect(names).toContain('triggers');
    // legacy item/DAG tables must be absent
    expect(names).not.toContain('space_items');
    expect(names).not.toContain('item_templates');
    expect(names).not.toContain('artifacts');
    expect(names).not.toContain('pipelines');
    expect(names).not.toContain('pipeline_tasks');
    expect(names).not.toContain('campaign_tasks');
  });

  it('stamps the schema version after migrating', () => {
    const version = getDb().pragma('user_version', { simple: true }) as number;
    expect(version).toBeGreaterThanOrEqual(1);
  });

  it('has no foreign keys referencing dropped campaign/plan tables', () => {
    const db = getDb();
    for (const name of ['space_items', 'artifacts', 'session_events']) {
      const sql = (db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
        .get(name) as { sql: string } | undefined)?.sql ?? '';
      expect(sql, `${name} references a dropped table`).not.toMatch(/REFERENCES\s+campaigns?\b|campaign_tasks|plans\b|plan_steps/);
    }
  });

  it('executions table has space_id column', () => {
    const db = getDb();
    const cols = db.prepare("SELECT name FROM pragma_table_info('executions')").all() as { name: string }[];
    expect(cols.some(c => c.name === 'space_id')).toBe(true);
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
