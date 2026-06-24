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
    const note = await request(app)
      .post(`/spaces/${spaceA.body.id}/items`)
      .set('Authorization', authorization)
      .send({ type: 'note', name: 'note-a', content: 'hello' });

    const crossSpace = await request(app)
      .get(`/spaces/${spaceB.body.id}/items/${repo.body.id}/tree`)
      .set('Authorization', authorization);
    expect(crossSpace.status).toBe(404);

    const unsupported = await request(app)
      .get(`/spaces/${spaceA.body.id}/items/${note.body.id}/tree`)
      .set('Authorization', authorization);
    expect(unsupported.status).toBe(400);
  });

  it('serves note item content through the item endpoint', async () => {
    const space = await request(app).post('/spaces').set('Authorization', authorization).send({ name: 'Notes Space' });
    const note = await request(app)
      .post(`/spaces/${space.body.id}/items`)
      .set('Authorization', authorization)
      .send({ type: 'note', name: 'Summary', content: '# Summary' });

    const content = await request(app)
      .get(`/spaces/${space.body.id}/items/${note.body.id}/content`)
      .set('Authorization', authorization);
    expect(content.status).toBe(200);
    expect(content.text).toBe('# Summary');
    expect(content.headers['content-type']).toContain('text/markdown');
  });

  it('updates note name and content', async () => {
    const space = await request(app).post('/spaces').set('Authorization', authorization).send({ name: 'Editable Notes' });
    const note = await request(app)
      .post(`/spaces/${space.body.id}/items`)
      .set('Authorization', authorization)
      .send({ type: 'note', name: 'Draft', content: 'old' });

    const updated = await request(app)
      .patch(`/spaces/${space.body.id}/items/${note.body.id}`)
      .set('Authorization', authorization)
      .send({ name: 'Final', content: 'new' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Final', content: 'new', type: 'note' });
  });
});
