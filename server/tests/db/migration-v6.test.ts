import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';

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
});
