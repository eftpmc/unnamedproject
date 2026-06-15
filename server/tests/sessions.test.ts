import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb, getDb } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';

let token: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `sess-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('sessions', () => {
  let sessionId: string;

  it('creates a session', async () => {
    const res = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Fix login bug' });
    expect(res.status).toBe(201);
    sessionId = res.body.id;
  });

  it('lists sessions ordered by updated_at desc', async () => {
    const res = await request(app)
      .get('/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].id).toBe(sessionId);
    expect(res.body[0].effort).toBe('medium');
  });

  it('updates session effort', async () => {
    const res = await request(app)
      .patch(`/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ effort: 'high' });
    expect(res.status).toBe(200);

    const list = await request(app)
      .get('/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(list.body[0].effort).toBe('high');
  });

  it('rejects invalid effort', async () => {
    const res = await request(app)
      .patch(`/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ effort: 'xhigh' });
    expect(res.status).toBe(400);
  });

  it('updates session title', async () => {
    const res = await request(app)
      .patch(`/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Fix the login bug' });
    expect(res.status).toBe(200);

    const list = await request(app)
      .get('/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(list.body[0].title).toBe('Fix the login bug');
  });

  it('reports active chat status from running turns', async () => {
    const messageId = newId();
    getDb()
      .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
      .run(messageId, sessionId, 'user', 'long task');
    getDb()
      .prepare('INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES (?,?,?,?)')
      .run(newId(), sessionId, messageId, 'running');

    const res = await request(app)
      .get(`/sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.turn.userMessageId).toBe(messageId);
  });

  it('includes active execution tool in chat status', async () => {
    const messageId = newId();
    getDb()
      .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
      .run(messageId, sessionId, 'assistant', 'working');
    getDb()
      .prepare('INSERT INTO executions (id, message_id, project_id, tool, status) VALUES (?,?,?,?,?)')
      .run(newId(), messageId, null, 'invoke_claude_code', 'running');

    const res = await request(app)
      .get(`/sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.execution.tool).toBe('invoke_claude_code');
  });

  it('DELETE /sessions/:id deletes the session', async () => {
    const create = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const id = create.body.id;

    const del = await request(app)
      .delete(`/sessions/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const list = await request(app)
      .get('/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(list.body.find((s: { id: string }) => s.id === id)).toBeUndefined();
  });

  it('DELETE /sessions/:id returns 404 for another user', async () => {
    const create = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const id = create.body.id;

    const other = await request(app)
      .post('/auth/register')
      .send({ email: `other-del-${Date.now()}@test.com`, password: 'pass' });
    const otherToken = other.body.token;

    const del = await request(app)
      .delete(`/sessions/${id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(del.status).toBe(404);
  });
});
