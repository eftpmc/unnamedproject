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
    .send({ email: `me-${Date.now()}@test.com`, password: 'password123' });
  token = res.body.token;
});

describe('POST /auth/register', () => {
  const email = `reg-${Date.now()}@test.com`;

  it('creates first user', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
  });

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123' });
    expect(res.status).toBe(409);
  });
});

describe('GET /auth/me', () => {
  it('GET /auth/me returns current user email', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toMatch(/@test\.com$/);
  });

  it('GET /auth/me returns 401 without token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/login', () => {
  const email2 = `login-${Date.now()}@test.com`;

  it('returns token on valid credentials', async () => {
    await request(app).post('/auth/register').send({ email: email2, password: 'password123' });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: email2, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: email2, password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
