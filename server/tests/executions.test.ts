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
  db.prepare('INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)').run(wsId, userId, `ws-${newId()}`, '[]');
  db.prepare("INSERT INTO executions (id, message_id, space_id, tool, status) VALUES (?,?,?,?,?)").run(executionId, msgId, wsId, 'git_op', 'awaiting_approval');
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

    const db = getDb();
    const approval = db.prepare('SELECT status, resolved_at FROM approvals WHERE execution_id = ?').get(executionId) as
      { status: string; resolved_at: number | null };
    const execution = db.prepare('SELECT status FROM executions WHERE id = ?').get(executionId) as { status: string };
    expect(approval.status).toBe('approved');
    expect(approval.resolved_at).toEqual(expect.any(Number));
    expect(execution.status).toBe('running');
  });

  it('rejects an execution and persists the decision', async () => {
    const db = getDb();
    const sessionId = newId();
    const msgId = newId();
    const projId = newId();
    const rejectExecId = newId();
    const rejectApprovalId = newId();
    db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'reject');
    db.prepare('INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)').run(projId, userId, `reject-${newId()}`, '[]');
    db.prepare("INSERT INTO executions (id, message_id, space_id, tool, status) VALUES (?,?,?,?,?)").run(rejectExecId, msgId, projId, 'git_op', 'awaiting_approval');
    db.prepare("INSERT INTO approvals (id, execution_id, action, payload) VALUES (?,?,?,?)").run(rejectApprovalId, rejectExecId, 'git push', '{}');

    const res = await request(app)
      .post(`/executions/${rejectExecId}/reject`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');

    const approval = db.prepare('SELECT status, resolved_at FROM approvals WHERE id = ?').get(rejectApprovalId) as
      { status: string; resolved_at: number | null };
    const execution = db.prepare('SELECT status FROM executions WHERE id = ?').get(rejectExecId) as { status: string };
    expect(approval.status).toBe('rejected');
    expect(approval.resolved_at).toEqual(expect.any(Number));
    expect(execution.status).toBe('running');
  });

  it('cancels a running execution', async () => {
    const db = getDb();
    const sessionId = newId();
    const msgId = newId();
    const projId = newId();
    const runningExecId = newId();
    db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'run');
    db.prepare('INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)').run(projId, userId, `proj-${newId()}`, '[]');
    db.prepare("INSERT INTO executions (id, message_id, space_id, tool, status) VALUES (?,?,?,?,?)").run(runningExecId, msgId, projId, 'invoke_claude_code', 'running');

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
    db.prepare('INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)').run(projId, userId, `proj-${newId()}`, '[]');
    db.prepare("INSERT INTO executions (id, message_id, space_id, tool, status) VALUES (?,?,?,?,?)").run(doneExecId, msgId, projId, 'invoke_claude_code', 'done');

    const res = await request(app)
      .post(`/executions/${doneExecId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
