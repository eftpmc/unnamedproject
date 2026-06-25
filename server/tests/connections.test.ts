import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { getDb, initDb, getMcpRegistryToolsForUser } from '../src/db/index.js';
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

  it('allows openai and local connections for the lead agent', async () => {
    const openai = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lead OpenAI', type: 'openai', purpose: 'lead_agent', config: { apiKey: 'sk-test', modelName: 'gpt-4o' } });
    expect(openai.status).toBe(201);

    const local = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lead Local', type: 'local', purpose: 'lead_agent', config: { baseUrl: 'http://localhost:11434/v1', modelName: 'qwen2.5:14b' } });
    expect(local.status).toBe(201);
  });

  it('requires model/base URL config for non-anthropic lead agent connections', async () => {
    const openai = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lead OpenAI Missing Model', type: 'openai', purpose: 'lead_agent', config: { apiKey: 'sk-test' } });
    expect(openai.status).toBe(400);
    expect(openai.body.error).toMatch(/modelName/);

    const local = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lead Local Missing Base', type: 'local', purpose: 'lead_agent', config: { modelName: 'qwen2.5:14b' } });
    expect(local.status).toBe(400);
    expect(local.body.error).toMatch(/baseUrl/);
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

  it('ingests MCP tools into the registry when an mcp connection is added', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'gh-mcp', type: 'mcp', purpose: 'mcp', config: { command: 'mock-mcp', args: '[]', env: '{}' } });
    expect(res.status).toBe(201);
    const mcpConnId = res.body.id;
    const ownUserId = (getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;

    await vi.waitFor(() => {
      const registered = getMcpRegistryToolsForUser(ownUserId);
      expect(registered.some(t => t.connection_id === mcpConnId && t.mcp_tool_name === 'search_web')).toBe(true);
    });
  });

  it('creates a claude_code connection', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'My Claude Code',
        type: 'claude_code',
        config: { mode: 'local', model: 'claude-sonnet-4-6', permissionProfile: 'default' },
      });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('claude_code');
  });

  it('creates a codex connection with api key', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'My Codex',
        type: 'codex',
        config: { mode: 'api', model: 'codex-mini-latest', permissionProfile: 'default', apiKey: 'sk-test' },
      });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('codex');
  });

  it('deletes a connection', async () => {
    const res = await request(app)
      .delete(`/connections/${connectionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
