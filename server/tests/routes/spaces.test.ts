import { beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import request from 'supertest';
import { getDb, initDb } from '../../src/db/index.js';
import { signToken } from '../../src/lib/jwt.js';
import spacesRouter from '../../src/routes/spaces.js';

const app = express();
app.use(express.json());
app.use('/spaces', spacesRouter);

let authorization: string;

beforeAll(() => {
  process.env.DATA_DIR = `/tmp/spaces-route-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u1', 'spaces@test.com', 'h')").run();
  authorization = `Bearer ${signToken('u1')}`;
});

describe('spaces routes', () => {
  it('creates and lists spaces without a repo_path field', async () => {
    const created = await request(app)
      .post('/spaces')
      .set('Authorization', authorization)
      .send({ name: 'Demo Space', repo_path: '/ignored' });
    expect(created.status).toBe(201);

    const listed = await request(app).get('/spaces').set('Authorization', authorization);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body.id, name: 'Demo Space' }),
    ]));
    expect(listed.body[0]).not.toHaveProperty('repo_path');
  });

  it('enforces item ownership and item-type capability checks', async () => {
    const spaceA = await request(app).post('/spaces').set('Authorization', authorization).send({ name: 'Space A' });
    const spaceB = await request(app).post('/spaces').set('Authorization', authorization).send({ name: 'Space B' });
    const repo = await request(app)
      .post(`/spaces/${spaceA.body.id}/items`)
      .set('Authorization', authorization)
      .send({ type: 'repo', name: 'repo-a', repo_path: '/repos/a' });
    const doc = await request(app)
      .post(`/spaces/${spaceA.body.id}/items`)
      .set('Authorization', authorization)
      .send({ type: 'blank', name: 'doc-a' });

    const crossSpace = await request(app)
      .get(`/spaces/${spaceB.body.id}/items/${repo.body.id}/tree`)
      .set('Authorization', authorization);
    expect(crossSpace.status).toBe(404);

    const unsupported = await request(app)
      .get(`/spaces/${spaceA.body.id}/items/${doc.body.id}/tree`)
      .set('Authorization', authorization);
    expect(unsupported.status).toBe(400);
  });

  it('rejects content update for non-note items', async () => {
    const space = await request(app).post('/spaces').set('Authorization', authorization).send({ name: 'No Content' });
    const doc = await request(app)
      .post(`/spaces/${space.body.id}/items`)
      .set('Authorization', authorization)
      .send({ type: 'blank', name: 'Doc' });

    const updated = await request(app)
      .patch(`/spaces/${space.body.id}/items/${doc.body.id}`)
      .set('Authorization', authorization)
      .send({ content: 'should fail' });
    expect(updated.status).toBe(400);
  });

  it('updates item name', async () => {
    const space = await request(app).post('/spaces').set('Authorization', authorization).send({ name: 'Rename Test' });
    const doc = await request(app)
      .post(`/spaces/${space.body.id}/items`)
      .set('Authorization', authorization)
      .send({ type: 'blank', name: 'Draft' });

    const updated = await request(app)
      .patch(`/spaces/${space.body.id}/items/${doc.body.id}`)
      .set('Authorization', authorization)
      .send({ name: 'Final' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Final', type: 'blank' });
  });
});
