import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { addDocumentItems } from '../db/index.js';

function buildPreV9Db(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, enabled_connection_ids TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE plans (id TEXT PRIMARY KEY, space_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE plan_steps (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, title TEXT NOT NULL);
    CREATE TABLE executions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE space_items (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('repo','file','note')),
      name TEXT NOT NULL,
      source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      source_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      source_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE space_repos (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      repo_path TEXT NOT NULL,
      default_branch TEXT
    );
    CREATE TABLE session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN (
        'scope_changed','project_linked','project_created','plan_created',
        'artifact_created','item_created','approval_requested','approval_resolved',
        'mcp_required','subagent_started','subagent_completed','connection_created'
      )),
      title TEXT NOT NULL,
      body TEXT,
      space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      item_id TEXT REFERENCES space_items(id) ON DELETE SET NULL,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

describe('migration v9: addDocumentItems', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = buildPreV9Db();
    addDocumentItems(db);
  });

  it('creates space_documents table with correct schema', () => {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
    expect(tables).toContain('space_documents');

    const cols = db.prepare("SELECT name, type FROM pragma_table_info('space_documents')").all() as { name: string; type: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('item_id');
    expect(colNames).toContain('template');
    expect(colNames).toContain('blocks');
  });

  it('adds overview_blocks column to space_repos', () => {
    const cols = db.prepare("SELECT name FROM pragma_table_info('space_repos')").all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('overview_blocks');
  });

  it('space_items.type CHECK allows document', () => {
    db.exec("INSERT INTO spaces VALUES ('s1','u1','S',NULL,'[]')");
    expect(() => {
      db.exec("INSERT INTO space_items VALUES ('i1','s1','document','Doc',NULL,NULL,NULL,1)");
    }).not.toThrow();
  });

  it('session_events.type CHECK allows item_updated', () => {
    db.exec("INSERT INTO sessions VALUES ('sess1','u1','T',1)");
    expect(() => {
      db.exec("INSERT INTO session_events (id, session_id, type, title) VALUES ('ev1','sess1','item_updated','Updated')");
    }).not.toThrow();
  });

  it('is idempotent — running twice does not throw', () => {
    expect(() => addDocumentItems(db)).not.toThrow();
  });
});
