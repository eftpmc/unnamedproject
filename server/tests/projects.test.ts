import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
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

describe('project media', () => {
  let mediaProjectId: string;
  let otherToken: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `media-${Date.now()}`, enabled_connection_ids: [] });
    mediaProjectId = res.body.id;

    const otherRes = await request(app)
      .post('/auth/register')
      .send({ email: `other-${Date.now()}@test.com`, password: 'pass' });
    otherToken = otherRes.body.token;
  });

  it('returns empty files list when media dir does not exist', async () => {
    const res = await request(app)
      .get(`/projects/${mediaProjectId}/media`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
  });

  it('lists files present in the media dir', async () => {
    const mediaDir = path.join(process.env.DATA_DIR!, 'projects', mediaProjectId, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'clip.mp4'), 'fake video data');

    const res = await request(app)
      .get(`/projects/${mediaProjectId}/media`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].name).toBe('clip.mp4');
    expect(res.body.files[0].url).toBe(`/projects/${mediaProjectId}/media/clip.mp4`);
    expect(typeof res.body.files[0].createdAt).toBe('number');
  });

  it('serves a media file with correct Content-Type', async () => {
    const res = await request(app)
      .get(`/projects/${mediaProjectId}/media/clip.mp4`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(Buffer.from(res.body).toString('utf-8')).toBe('fake video data');
  });

  it('rejects filenames containing path traversal', async () => {
    const res1 = await request(app)
      .get(`/projects/${mediaProjectId}/media/..%2F..%2Fetc%2Fpasswd`)
      .set('Authorization', `Bearer ${token}`);
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .get(`/projects/${mediaProjectId}/media/sub%2Ffile.mp4`)
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(400);
  });

  it('serves a media file via query token auth without Authorization header', async () => {
    const res = await request(app)
      .get(`/projects/${mediaProjectId}/media/clip.mp4?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
  });

  it('returns 404 for media list of a project not owned by the requesting user', async () => {
    const res = await request(app)
      .get(`/projects/${mediaProjectId}/media`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for media file of a project not owned by the requesting user', async () => {
    const res = await request(app)
      .get(`/projects/${mediaProjectId}/media/clip.mp4`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });
});
