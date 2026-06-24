import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { createExecution, appendOutput, completeExecution } from '../../src/services/executor.js';
import { newId } from '../../src/lib/ids.js';
import { broadcast } from '../../src/services/socket.js';

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));

const userId = newId();
let sessionId: string;
let messageId: string;
let projectId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `exec-${userId}@test.com`, 'x');
  sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
  messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(messageId, sessionId, 'user', 'hello');
  projectId = newId();
  db.prepare('INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)').run(projectId, userId, 'test-ws', '[]');
});

describe('executor', () => {
  it('creates an execution and transitions through lifecycle', () => {
    vi.mocked(broadcast).mockClear();
    const id = createExecution(userId, messageId, projectId, 'git_op');
    expect(getDb().prepare('SELECT status FROM executions WHERE id = ?').get(id)).toMatchObject({ status: 'running' });
    expect(broadcast).toHaveBeenCalledWith(userId, expect.objectContaining({
      type: 'execution_update',
      sessionId,
      executionId: id,
      status: 'running',
    }));

    appendOutput(id, userId, 'line 1\n');
    const row = getDb().prepare('SELECT output_log FROM executions WHERE id = ?').get(id) as { output_log: string };
    expect(row.output_log).toContain('line 1');

    completeExecution(id, userId, 'done', 'finished ok');
    expect(getDb().prepare('SELECT status FROM executions WHERE id = ?').get(id)).toMatchObject({ status: 'done' });
    expect(broadcast).toHaveBeenCalledWith(userId, expect.objectContaining({
      type: 'execution_update',
      sessionId,
      executionId: id,
      status: 'done',
    }));
  });
});
