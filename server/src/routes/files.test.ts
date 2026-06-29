import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import { getDb, initDb } from '../db/index.js';
import { signToken } from '../lib/jwt.js';
import filesRouter from './files.js';

const app = express();
app.use(express.json());
app.use('/files', filesRouter);

let authorization: string;

beforeAll(() => {
  process.env.DATA_DIR = `/tmp/files-route-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb()
    .prepare("INSERT INTO users (id, email, hashed_password) VALUES ('doc-test-user', 'docs@test.com', 'h')")
    .run();
  authorization = `Bearer ${signToken('doc-test-user')}`;
});

describe('GET /files', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/files').set('Authorization', authorization);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /files/:id', () => {
  it('returns 404 for nonexistent doc', async () => {
    const res = await request(app).get('/files/nonexistent').set('Authorization', authorization);
    expect(res.status).toBe(404);
  });
});
