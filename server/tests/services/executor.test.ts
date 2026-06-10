import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { createExecution, appendOutput, completeExecution } from '../../src/services/executor.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));

const userId = newId();
let messageId: string;
let workspaceId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `exec-${userId}@test.com`, 'x');
  const sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
  messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(messageId, sessionId, 'user', 'hello');
  workspaceId = newId();
  db.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?,?,?)').run(workspaceId, userId, 'test-ws');
});

describe('executor', () => {
  it('creates an execution and transitions through lifecycle', () => {
    const id = createExecution(userId, messageId, workspaceId, 'git_op');
    expect(getDb().prepare('SELECT status FROM executions WHERE id = ?').get(id)).toMatchObject({ status: 'running' });

    appendOutput(id, userId, 'line 1\n');
    const row = getDb().prepare('SELECT output_log FROM executions WHERE id = ?').get(id) as { output_log: string };
    expect(row.output_log).toContain('line 1');

    completeExecution(id, userId, 'done', 'finished ok');
    expect(getDb().prepare('SELECT status FROM executions WHERE id = ?').get(id)).toMatchObject({ status: 'done' });
  });
});
