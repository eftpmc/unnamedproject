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
    .send({ email: `conn-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('connections', () => {
  let connectionId: string;

  it('creates a connection', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My Anthropic Key', type: 'anthropic', config: { apiKey: 'sk-test' } });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    connectionId = res.body.id;
  });

  it('lists connections (config not exposed)', async () => {
    const res = await request(app)
      .get('/connections')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].config).toBeUndefined();
  });

  it('deletes a connection', async () => {
    const res = await request(app)
      .delete(`/connections/${connectionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
