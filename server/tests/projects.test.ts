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
    .send({ email: `proj-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('projects', () => {
  let projectId: string;

  it('creates a project with a repo path', async () => {
    const res = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'api', description: 'My API project', enabled_connection_ids: [] });
    expect(res.status).toBe(201);
    projectId = res.body.id;
  });

  it('creates a project without a repo path', async () => {
    const res = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'notes', enabled_connection_ids: [] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it('lists projects with parsed enabled_connection_ids and nullable repo_path', async () => {
    const res = await request(app)
      .get('/projects')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body[0].enabled_connection_ids)).toBe(true);
    const notes = res.body.find((p: { name: string }) => p.name === 'notes');
    expect(notes.repo_path).toBeNull();
  });

  it('deletes a project', async () => {
    const res = await request(app)
      .delete(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
