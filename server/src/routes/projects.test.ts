import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import { getDb, initDb } from '../db/index.js';
import { signToken } from '../lib/jwt.js';
import projectsRouter from './projects.js';

const app = express();
app.use(express.json());
app.use('/projects', projectsRouter);

let authorization: string;

beforeAll(() => {
  process.env.DATA_DIR = `/tmp/projects-route-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb()
    .prepare("INSERT INTO users (id, email, hashed_password) VALUES ('proj-test-user', 'projects@test.com', 'h')")
    .run();
  authorization = `Bearer ${signToken('proj-test-user')}`;
});

describe('GET /projects', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/projects').set('Authorization', authorization);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /projects', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/projects').set('Authorization', authorization).send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /projects/:id', () => {
  it('returns 404 for nonexistent project', async () => {
    const res = await request(app).get('/projects/nonexistent').set('Authorization', authorization);
    expect(res.status).toBe(404);
  });
});
