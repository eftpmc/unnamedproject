import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { getDb, initDb } from '../src/db/index.js';
import { getDecryptedConfig } from '../src/routes/connections.js';

vi.mock('../src/lib/mcp-pool.js', () => ({
  listMcpTools: vi.fn().mockResolvedValue([
    { name: 'search_web', description: 'Search the web', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  ]),
  callMcpTool: vi.fn().mockResolvedValue('mcp tool result'),
}));

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

  it('creates an mcp connection', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'My MCP Server',
        type: 'mcp',
        config: { command: 'npx', args: ['-y', '@some/mcp-server'] },
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.type).toBe('mcp');
    connectionId = res.body.id;
  });

  it('lists connections (config not exposed)', async () => {
    const res = await request(app)
      .get('/connections')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].config).toBeUndefined();
  });

  it('rejects invalid connection type', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Type', type: 'anthropic', config: {} });
    expect(res.status).toBe(400);
  });

  it('decrypts config only for the owning user', async () => {
    const ownUserId = (getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;

    const conn = getDb().prepare("SELECT id FROM connections WHERE user_id = ?").get(ownUserId) as { id: string } | undefined;
    expect(conn).toBeDefined();
    expect(() => getDecryptedConfig(conn!.id, secondUserId)).toThrow(/not found/);

    const list = await request(app)
      .get('/connections')
      .set('Authorization', `Bearer ${secondToken}`);
    expect(list.body).toEqual([]);
  });

  it('creates a github connection', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'My GitHub',
        type: 'github',
        config: { token: 'ghp_test' },
      });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('github');
  });

  it('deletes a connection', async () => {
    const res = await request(app)
      .delete(`/connections/${connectionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
