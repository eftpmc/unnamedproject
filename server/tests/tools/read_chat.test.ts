import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { readChat } from '../../src/tools/read_chat.js';
import { newId } from '../../src/lib/ids.js';

const userId = newId();
const otherUserId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `read-chat-${userId}@test.com`, 'x');
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(otherUserId, `read-chat-other-${userId}@test.com`, 'x');

  sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(sessionId, userId, 'My test chat');
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(newId(), sessionId, 'user', 'Hello there');
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(newId(), sessionId, 'assistant', 'Hi! How can I help?');
});

describe('readChat', () => {
  it('returns formatted messages for a valid chat', () => {
    const result = readChat(userId, sessionId);
    expect(result).toContain('My test chat');
    expect(result).toContain('[user]: Hello there');
    expect(result).toContain('[assistant]: Hi! How can I help?');
  });

  it('returns error for chat owned by another user', () => {
    const result = readChat(otherUserId, sessionId);
    expect(result).toContain('not found');
  });

  it('returns error for non-existent chat', () => {
    const result = readChat(userId, 'fake-id');
    expect(result).toContain('not found');
  });
});
