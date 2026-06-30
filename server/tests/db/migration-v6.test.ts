import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb, reconcileOrphanedExecutions } from '../../src/db/index.js';

const DATA_DIR = process.env.DATA_DIR!;

beforeAll(() => {
  closeDb();
  const dbPath = path.join(DATA_DIR, 'app.db');
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  initDb();
});

afterAll(() => closeDb());

describe('migration v6', () => {
  it('sessions has provider_type and provider_session_id columns', () => {
    const db = getDb();
    const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const cols = info.map(r => r.name);
    expect(cols).toContain('provider_type');
    expect(cols).toContain('provider_session_id');
  });

  it('agent_usage has per-turn attribution columns', () => {
    const db = getDb();
    const info = db.prepare("PRAGMA table_info(agent_usage)").all() as Array<{ name: string }>;
    const cols = info.map(r => r.name);
    expect(cols).toContain('session_id');
    expect(cols).toContain('turn_id');
    expect(cols).toContain('message_id');
    expect(cols).toContain('execution_id');
  });

  it('sessions has a structured session_state column', () => {
    const db = getDb();
    const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const cols = info.map(r => r.name);
    expect(cols).toContain('session_state');
  });

  it('session_turns has invocation observability columns', () => {
    const db = getDb();
    const info = db.prepare("PRAGMA table_info(session_turns)").all() as Array<{ name: string }>;
    const cols = info.map(r => r.name);
    expect(cols).toContain('invocation_mode');
    expect(cols).toContain('provider_type');
    expect(cols).toContain('provider_session_id');
  });

  it('session_events accepts runtime checkpoints', () => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO users (id, email, hashed_password) VALUES ('u-runtime','runtime-v6@test.com','x')").run();
    db.prepare("INSERT OR IGNORE INTO sessions (id, user_id) VALUES ('s-runtime','u-runtime')").run();
    expect(() => {
      db.prepare("INSERT INTO session_events (id, session_id, type, title) VALUES ('evt-runtime','s-runtime','runtime_checkpoint','Checkpoint')").run();
    }).not.toThrow();
  });

  it('connections accepts mcp and github types', () => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO users (id, email, hashed_password) VALUES ('u1','test-v6@test.com','x')").run();
    expect(() => {
      db.prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES ('c1','u1','My MCP','mcp','{}')").run();
    }).not.toThrow();
    expect(() => {
      db.prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES ('c2','u1','My GitHub','github','{}')").run();
    }).not.toThrow();
  });

  it('connections rejects unknown types', () => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO users (id, email, hashed_password) VALUES ('u1','test-v6@test.com','x')").run();
    expect(() => {
      db.prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES ('c3','u1','Bad','unknown','{}')").run();
    }).toThrow();
  });

  it('reconciles interrupted turns without leaving blank assistant messages', () => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO users (id, email, hashed_password) VALUES ('u-reconcile','reconcile@test.com','x')").run();
    db.prepare("INSERT OR IGNORE INTO sessions (id, user_id) VALUES ('s-reconcile','u-reconcile')").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('m-reconcile-user','s-reconcile','user','continue',100)").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('m-reconcile-empty','s-reconcile','assistant','',100)").run();
    db.prepare("INSERT INTO session_turns (id, session_id, user_message_id, status, started_at) VALUES ('t-reconcile','s-reconcile','m-reconcile-user','running',100)").run();

    reconcileOrphanedExecutions();

    const blank = db.prepare("SELECT id FROM messages WHERE id = 'm-reconcile-empty'").get();
    expect(blank).toBeUndefined();
    const turn = db.prepare("SELECT status, error FROM session_turns WHERE id = 't-reconcile'").get() as { status: string; error: string };
    expect(turn.status).toBe('error');
    expect(turn.error).toBe('Interrupted by server restart');
  });
});
