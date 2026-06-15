import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb, getDb } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';

vi.mock('../src/services/agent.js', () => ({
  runAgentTurn: vi.fn().mockImplementation(async (_userId: string, sessionId: string, userMessageId: string) => {
    getDb().prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
      .run(newId(), sessionId, 'assistant', 'Agent reply here');
    getDb()
      .prepare("UPDATE session_turns SET status = 'done', completed_at = unixepoch() WHERE session_id = ? AND user_message_id = ?")
      .run(sessionId, userMessageId);
  }),
}));
vi.mock('../src/services/socket.js', () => ({ broadcast: vi.fn(), initSocket: vi.fn() }));

let token: string;
let sessionId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const reg = await request(app)
    .post('/auth/register')
    .send({ email: `msg-${Date.now()}@test.com`, password: 'pass' });
  token = reg.body.token;
  const s = await request(app)
    .post('/sessions')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Test session' });
  sessionId = s.body.id;
});

describe('messages', () => {
  it('saves user message and returns it', async () => {
    const res = await request(app)
      .post(`/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Hello agent' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('user');
    expect(res.body.content).toBe('Hello agent');
  });

  it('lists messages including the assistant reply', async () => {
    await new Promise(r => setTimeout(r, 150));
    const res = await request(app)
      .get(`/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const roles = (res.body as { role: string }[]).map(m => m.role);
    expect(roles).toContain('assistant');
    expect(res.body.every((m: { executions: unknown[] }) => Array.isArray(m.executions))).toBe(true);
    expect(res.body.every((m: { attachments: unknown[] }) => Array.isArray(m.attachments))).toBe(true);
  });

  it('stores attachments on user messages', async () => {
    const res = await request(app)
      .post(`/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .field('content', 'Review this file')
      .attach('attachments', Buffer.from('hello from an attachment'), {
        filename: 'notes.md',
        contentType: 'text/markdown',
      });

    expect(res.status).toBe(201);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0]).toMatchObject({
      filename: 'notes.md',
      mimeType: 'text/markdown',
      sizeBytes: 24,
    });

    const list = await request(app)
      .get(`/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${token}`);
    const message = (list.body as { id: string; attachments: unknown[] }[]).find(m => m.id === res.body.id);
    expect(message?.attachments).toHaveLength(1);
  });

  it('embeds executions linked to a message so a reload can rehydrate tool runs', async () => {
    const assistant = getDb()
      .prepare("SELECT id FROM messages WHERE session_id = ? AND role = 'assistant' LIMIT 1")
      .get(sessionId) as { id: string };

    const executionId = newId();
    getDb()
      .prepare("INSERT INTO executions (id, message_id, project_id, tool, status, output_log, result) VALUES (?,?,?,?,?,?,?)")
      .run(executionId, assistant.id, null, 'invoke_claude_code', 'done', 'doing the work\n', 'Done.');

    const res = await request(app)
      .get(`/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const withExec = (res.body as { id: string; executions: { executionId: string; tool: string; status: string; outputLog: string; result: string | null }[] }[])
      .find(m => m.id === assistant.id)!;
    expect(withExec.executions).toHaveLength(1);
    expect(withExec.executions[0]).toMatchObject({
      executionId,
      tool: 'invoke_claude_code',
      status: 'done',
      outputLog: 'doing the work\n',
      result: 'Done.',
    });
  });
});
