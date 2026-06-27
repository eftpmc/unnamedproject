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

  it('updates a space name and description', async () => {
    const created = await request(app)
      .post('/spaces')
      .set('Authorization', authorization)
      .send({ name: 'Original Name' });
    expect(created.status).toBe(201);

    const updated = await request(app)
      .patch(`/spaces/${created.body.id}`)
      .set('Authorization', authorization)
      .send({ name: 'Updated Name', description: 'new desc' });
    expect(updated.status).toBe(200);

    const listed = await request(app).get('/spaces').set('Authorization', authorization);
    const space = listed.body.find((s: { id: string }) => s.id === created.body.id);
    expect(space.name).toBe('Updated Name');
    expect(space.description).toBe('new desc');
  });

  it('deletes a space', async () => {
    const created = await request(app)
      .post('/spaces')
      .set('Authorization', authorization)
      .send({ name: 'To Delete' });
    expect(created.status).toBe(201);

    const deleted = await request(app)
      .delete(`/spaces/${created.body.id}`)
      .set('Authorization', authorization);
    expect(deleted.status).toBe(204);

    const listed = await request(app).get('/spaces').set('Authorization', authorization);
    expect(listed.body.find((s: { id: string }) => s.id === created.body.id)).toBeUndefined();
  });
});
