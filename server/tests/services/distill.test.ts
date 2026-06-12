import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { shouldDistill, getTurnCount } from '../../src/services/distill.js';

const userId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `dist-${userId}@test.com`, 'x');
  sessionId = newId();
  getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
});

function addMessages(n: number): void {
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    getDb().prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(newId(), sessionId, role, `msg ${i}`);
  }
}

describe('shouldDistill', () => {
  it('returns false when session has fewer than 20 messages', () => {
    addMessages(10);
    expect(shouldDistill(sessionId)).toBe(false);
  });

  it('returns true when session hits exactly 20 messages', () => {
    addMessages(10); // total: 20
    expect(shouldDistill(sessionId)).toBe(true);
  });

  it('returns true at turn 30, 40, etc (every 10 thereafter)', () => {
    addMessages(10); // total: 30
    expect(shouldDistill(sessionId)).toBe(true);
  });

  it('returns false at turn 25 (not a trigger point)', () => {
    const sid2 = newId();
    getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sid2, userId);
    for (let i = 0; i < 25; i++) {
      getDb().prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(newId(), sid2, i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`);
    }
    expect(shouldDistill(sid2)).toBe(false);
  });
});

describe('getTurnCount', () => {
  it('counts total messages in a session', () => {
    const count = getTurnCount(sessionId);
    expect(count).toBeGreaterThanOrEqual(30);
  });
});
