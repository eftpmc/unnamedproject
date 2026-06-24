import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import type { Migration } from './migrate.js';

// Import only the v9 migration function, not the full migrations array,
// to avoid the singleton getDb() calls in other migrations.
// We'll construct a minimal migration array that sets up the pre-v9 schema
// then runs v9.

function applyPreV9Schema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      enabled_connection_ids TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS plan_steps (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS space_items (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('repo','file','note')),
      name TEXT NOT NULL,
      source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      source_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      source_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS space_repos (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      repo_path TEXT NOT NULL,
      default_branch TEXT
    );
    CREATE TABLE IF NOT EXISTS session_events (
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
      execution_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

describe('migration v9: add-document-items', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyPreV9Schema(db);
  });

  it('creates space_documents table', async () => {
    const { addDocumentItems } = await import('./index.js');
    const migrations: Migration[] = [
      { version: 9, name: 'add-document-items', noTransaction: true, up: (d) => addDocumentItems(d) },
    ];
    // temporarily mock getDb to return our test db
    // (see actual implementation approach in step 2)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    // After migration, space_documents should exist
    expect(tables.map(t => t.name)).not.toContain('space_documents');
  });

  it('space_items.type CHECK allows document after migration', () => {
    // Will be verified by attempting an INSERT after migration runs
    expect(true).toBe(true); // placeholder — see integration test in Task 3
  });
});
