import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';
import { rememberFact } from '../src/services/memory.js';

let token: string;
let userId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `mem-route-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
  // Decode userId from JWT payload (middle segment)
  const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64').toString());
  userId = payload.userId;
  rememberFact(userId, 'user', 'preferred_language', 'TypeScript');
  rememberFact(userId, 'feedback', 'package_manager', 'use pnpm, not npm');
});

describe('GET /memory', () => {
  it('returns all memory entries for the user', async () => {
    const res = await request(app)
      .get('/memory')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toContainEqual({ type: 'user', key: 'preferred_language', value: 'TypeScript', project_id: null });
    expect(res.body).toContainEqual({ type: 'feedback', key: 'package_manager', value: 'use pnpm, not npm', project_id: null });
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/memory');
    expect(res.status).toBe(401);
  });
});
