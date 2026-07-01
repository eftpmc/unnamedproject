import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';
import { APP_ROOT } from '../src/lib/workspacePaths.js';

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
  it('returns a default projects_root when unset', async () => {
    const res = await request(app)
      .get('/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.projects_root).toContain('/tmp/unnamedproject-workspaces/projects/');
    expect(res.body.permission_profile).toBe('fast');
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

  it('updates permission_profile', async () => {
    const put = await request(app)
      .put('/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ projects_root: '/tmp/projects', permission_profile: 'self_modify' });
    expect(put.status).toBe(200);
    expect(put.body.permission_profile).toBe('self_modify');
  });

  it('rejects invalid permission_profile values', async () => {
    const put = await request(app)
      .put('/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ projects_root: '/tmp/projects', permission_profile: 'loose' });
    expect(put.status).toBe(400);
  });

  it('rejects projects_root inside the app repository', async () => {
    const put = await request(app)
      .put('/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ projects_root: APP_ROOT });
    expect(put.status).toBe(400);
  });
});
