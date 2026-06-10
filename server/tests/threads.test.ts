import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';

let token: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `th-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('threads', () => {
  let threadId: string;

  it('creates a thread', async () => {
    const res = await request(app)
      .post('/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Fix login bug' });
    expect(res.status).toBe(201);
    threadId = res.body.id;
  });

  it('lists threads ordered by updated_at desc', async () => {
    const res = await request(app)
      .get('/threads')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].id).toBe(threadId);
  });
});
