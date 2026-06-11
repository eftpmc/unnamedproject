import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb, getDb } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';

vi.mock('../src/services/socket.js', () => ({ broadcast: vi.fn(), initSocket: vi.fn() }));
vi.mock('../src/lib/process-registry.js', () => ({ killProcess: vi.fn().mockReturnValue(true) }));

let token: string;
let userId: string;
let executionId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const reg = await request(app)
    .post('/auth/register')
    .send({ email: `exec2-${Date.now()}@test.com`, password: 'pass' });
  token = reg.body.token;

  // Decode userId from JWT
  const { verifyToken } = await import('../src/lib/jwt.js');
  userId = verifyToken(reg.body.token).userId;

  const db = getDb();
  const sessionId = newId();
  const msgId = newId();
  const wsId = newId();
  executionId = newId();
  const approvalId = newId();

  db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'test');
  db.prepare('INSERT INTO projects (id, user_id, name) VALUES (?,?,?)').run(wsId, userId, `ws-${newId()}`);
  db.prepare("INSERT INTO executions (id, message_id, project_id, tool, status) VALUES (?,?,?,?,?)").run(executionId, msgId, wsId, 'git_op', 'awaiting_approval');
  db.prepare("INSERT INTO approvals (id, execution_id, action, payload) VALUES (?,?,?,?)").run(approvalId, executionId, 'git commit', '{"message":"fix bug"}');
});

describe('executions', () => {
  it('gets an execution by id', async () => {
    const res = await request(app)
      .get(`/executions/${executionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('awaiting_approval');
  });

  it('approves an execution', async () => {
    const res = await request(app)
      .post(`/executions/${executionId}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  it('cancels a running execution', async () => {
    const db = getDb();
    const sessionId = newId();
    const msgId = newId();
    const projId = newId();
    const runningExecId = newId();
    db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'run');
    db.prepare('INSERT INTO projects (id, user_id, name) VALUES (?,?,?)').run(projId, userId, `proj-${newId()}`);
    db.prepare("INSERT INTO executions (id, message_id, project_id, tool, status) VALUES (?,?,?,?,?)").run(runningExecId, msgId, projId, 'invoke_claude_code', 'running');

    const res = await request(app)
      .post(`/executions/${runningExecId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const check = await request(app)
      .get(`/executions/${runningExecId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(check.body.status).toBe('error');
  });

  it('returns 404 when cancelling a completed execution', async () => {
    const db = getDb();
    const sessionId = newId();
    const msgId = newId();
    const projId = newId();
    const doneExecId = newId();
    db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'run');
    db.prepare('INSERT INTO projects (id, user_id, name) VALUES (?,?,?)').run(projId, userId, `proj-${newId()}`);
    db.prepare("INSERT INTO executions (id, message_id, project_id, tool, status) VALUES (?,?,?,?,?)").run(doneExecId, msgId, projId, 'invoke_claude_code', 'done');

    const res = await request(app)
      .post(`/executions/${doneExecId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
