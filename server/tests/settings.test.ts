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
    .send({ email: `settings-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('settings', () => {
  it('returns null projects_root by default', async () => {
    const res = await request(app)
      .get('/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.projects_root).toBeNull();
  });

  it('updates projects_root', async () => {
    const put = await request(app)
      .put('/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ projects_root: '/tmp/projects' });
    expect(put.status).toBe(200);

    const get = await request(app)
      .get('/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(get.body.projects_root).toBe('/tmp/projects');
  });
});
