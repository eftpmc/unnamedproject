import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb, getDb } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';

vi.mock('../src/services/agent.js', () => ({
  runAgentTurn: vi.fn().mockImplementation(async (_userId: string, sessionId: string) => {
    getDb().prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
      .run(newId(), sessionId, 'assistant', 'Agent reply here');
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
  });
});
