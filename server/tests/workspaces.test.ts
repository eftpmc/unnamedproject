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
    .send({ email: `ws-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('workspaces', () => {
  let wsId: string;

  it('creates a workspace', async () => {
    const res = await request(app)
      .post('/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'api', description: 'My API project', enabled_connection_ids: [] });
    expect(res.status).toBe(201);
    wsId = res.body.id;
  });

  it('lists workspaces with parsed enabled_connection_ids', async () => {
    const res = await request(app)
      .get('/workspaces')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body[0].enabled_connection_ids)).toBe(true);
  });

  it('deletes a workspace', async () => {
    const res = await request(app)
      .delete(`/workspaces/${wsId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
