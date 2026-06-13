import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { getDb, initDb } from '../src/db/index.js';
import { getDecryptedConfig } from '../src/routes/connections.js';

let token: string;
let secondToken: string;
let secondUserId: string;
let email: string;
let secondEmail: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  email = `conn-${Date.now()}@test.com`;
  const res = await request(app)
    .post('/auth/register')
    .send({ email, password: 'pass' });
  token = res.body.token;
  secondEmail = `conn-other-${Date.now()}@test.com`;
  const second = await request(app)
    .post('/auth/register')
    .send({ email: secondEmail, password: 'pass' });
  secondToken = second.body.token;
  secondUserId = (getDb().prepare('SELECT id FROM users WHERE email = ?').get(secondEmail) as { id: string }).id;
});

describe('connections', () => {
  let connectionId: string;

  it('creates a connection', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My Anthropic Key', type: 'anthropic', purpose: 'lead_agent', config: { apiKey: 'sk-test' } });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    connectionId = res.body.id;
  });

  it('lists connections (config not exposed)', async () => {
    const res = await request(app)
      .get('/connections')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].config).toBeUndefined();
    expect(res.body[0].purpose).toBe('lead_agent');
  });

  it('rejects incompatible purpose/type pairs', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Codex', type: 'anthropic', purpose: 'codex', config: { apiKey: 'sk-test' } });
    expect(res.status).toBe(400);
  });

  it('decrypts config only for the owning user', async () => {
    const ownUserId = (getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;

    expect(getDecryptedConfig(connectionId, ownUserId).apiKey).toBe('sk-test');
    expect(() => getDecryptedConfig(connectionId, secondUserId)).toThrow(/not found/);

    const list = await request(app)
      .get('/connections')
      .set('Authorization', `Bearer ${secondToken}`);
    expect(list.body).toEqual([]);
  });

  it('deletes a connection', async () => {
    const res = await request(app)
      .delete(`/connections/${connectionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
