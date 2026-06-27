// Auth bootstrapping pattern copied from server/tests/routes/spaces.test.ts:
// create a local express app with just the router, insert a test user via getDb(),
// and generate a JWT via signToken. DATA_DIR is set to a unique tmp path per test file.

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import fs from 'fs';
import request from 'supertest';
import { getDb, initDb } from '../db/index.js';
import { signToken } from '../lib/jwt.js';
import spacesRouter from './spaces.js';

const app = express();
app.use(express.json());
app.use('/spaces', spacesRouter);

let authorization: string;
let spaceId: string;

beforeAll(async () => {
  process.env.DATA_DIR = `/tmp/spaces-content-route-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb()
    .prepare("INSERT INTO users (id, email, hashed_password) VALUES ('uc1', 'content@test.com', 'h')")
    .run();
  authorization = `Bearer ${signToken('uc1')}`;

  const res = await request(app)
    .post('/spaces')
    .set('Authorization', authorization)
    .send({ name: 'Content Space' });
  spaceId = res.body.id;
});

describe('space content routes', () => {
  describe('documents', () => {
    it('creates and lists a document', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/documents`)
        .set('Authorization', authorization)
        .send({ path: 'r.md', title: 'R', frontmatter: { type: 'resume' }, body: '# R' });
      expect(create.status).toBe(201);
      const list = await request(app)
        .get(`/spaces/${spaceId}/documents?type=resume`)
        .set('Authorization', authorization);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
    });

    it('reads a document by id', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/documents`)
        .set('Authorization', authorization)
        .send({ path: 'read-me.md', title: 'Read Me', body: 'hello' });
      expect(create.status).toBe(201);

      const read = await request(app)
        .get(`/spaces/${spaceId}/documents/${create.body.id}`)
        .set('Authorization', authorization);
      expect(read.status).toBe(200);
      expect(read.body.title).toBe('Read Me');
      expect(read.body.body).toBe('hello');
    });

    it('patches document frontmatter only', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/documents`)
        .set('Authorization', authorization)
        .send({ path: 'patch-fm.md', title: 'Patch FM', frontmatter: { status: 'draft' }, body: 'content' });
      expect(create.status).toBe(201);

      const patch = await request(app)
        .patch(`/spaces/${spaceId}/documents/${create.body.id}`)
        .set('Authorization', authorization)
        .send({ frontmatter: { status: 'done' } });
      expect(patch.status).toBe(200);
      expect(patch.body.frontmatter.status).toBe('done');
    });

    it('patches document title/body', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/documents`)
        .set('Authorization', authorization)
        .send({ path: 'patch-body.md', title: 'Old Title', body: 'old body' });
      expect(create.status).toBe(201);

      const patch = await request(app)
        .patch(`/spaces/${spaceId}/documents/${create.body.id}`)
        .set('Authorization', authorization)
        .send({ title: 'New Title', body: 'new body' });
      expect(patch.status).toBe(200);
      expect(patch.body.title).toBe('New Title');
    });

    it('deletes a document', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/documents`)
        .set('Authorization', authorization)
        .send({ path: 'delete-me.md', title: 'Delete Me', body: 'bye' });
      expect(create.status).toBe(201);

      const del = await request(app)
        .delete(`/spaces/${spaceId}/documents/${create.body.id}`)
        .set('Authorization', authorization);
      expect(del.status).toBe(204);

      const read = await request(app)
        .get(`/spaces/${spaceId}/documents/${create.body.id}`)
        .set('Authorization', authorization);
      expect(read.status).toBe(404);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await request(app)
        .post(`/spaces/${spaceId}/documents`)
        .set('Authorization', authorization)
        .send({ path: 'missing.md' });
      expect(res.status).toBe(400);
    });
  });

  describe('projects', () => {
    it('links and lists a project', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/projects`)
        .set('Authorization', authorization)
        .send({ name: 'My Repo', repo_path: '/tmp/test-proj-link' });
      expect(create.status).toBe(201);
      expect(create.body.id).toBeTruthy();
      expect(create.body.origin).toBe('linked');

      const list = await request(app)
        .get(`/spaces/${spaceId}/projects`)
        .set('Authorization', authorization);
      expect(list.status).toBe(200);
      expect(list.body.length).toBeGreaterThan(0);
    });

    it('deletes a project', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/projects`)
        .set('Authorization', authorization)
        .send({ name: 'To Delete', repo_path: '/tmp/delete-proj' });
      expect(create.status).toBe(201);

      const del = await request(app)
        .delete(`/spaces/${spaceId}/projects/${create.body.id}`)
        .set('Authorization', authorization);
      expect(del.status).toBe(204);
    });
  });

  describe('triggers', () => {
    it('creates and lists a manual trigger', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/triggers`)
        .set('Authorization', authorization)
        .send({ kind: 'manual' });
      expect(create.status).toBe(201);
      expect(create.body.id).toBeTruthy();

      const list = await request(app)
        .get(`/spaces/${spaceId}/triggers`)
        .set('Authorization', authorization);
      expect(list.status).toBe(200);
      expect(list.body.length).toBeGreaterThan(0);
    });

    it('creates a schedule trigger with next_run_at computed', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/triggers`)
        .set('Authorization', authorization)
        .send({ kind: 'schedule', schedule_cron: '0 * * * *' });
      expect(create.status).toBe(201);
      expect(create.body.next_run_at).toBeTruthy();
    });

    it('deletes a trigger', async () => {
      const create = await request(app)
        .post(`/spaces/${spaceId}/triggers`)
        .set('Authorization', authorization)
        .send({ kind: 'webhook' });
      expect(create.status).toBe(201);

      const del = await request(app)
        .delete(`/spaces/${spaceId}/triggers/${create.body.id}`)
        .set('Authorization', authorization);
      expect(del.status).toBe(204);
    });
  });
});
