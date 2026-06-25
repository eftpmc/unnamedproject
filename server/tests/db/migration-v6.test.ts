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

  it('connections accepts claude_code and codex types', () => {
    const db = getDb();
    // Insert a user first
    db.prepare("INSERT OR IGNORE INTO users (id, email, hashed_password) VALUES ('u1','test@test.com','x')").run();
    expect(() => {
      db.prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES ('c1','u1','Claude Code','claude_code','{}')").run();
    }).not.toThrow();
    expect(() => {
      db.prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES ('c2','u1','Codex','codex','{}')").run();
    }).not.toThrow();
  });

  it('connections rejects unknown types', () => {
    const db = getDb();
    expect(() => {
      db.prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES ('c3','u1','Bad','unknown','{}')").run();
    }).toThrow();
  });
});
