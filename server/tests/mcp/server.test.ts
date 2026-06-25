import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { initDb, closeDb } from '../../src/db/index.js';
import mcpRouter from '../../src/mcp/index.js';
import { generateMcpToken } from '../../src/mcp/auth.js';
import { registerTool } from '../../src/mcp/registry.js';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR!;

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  registerTool({
    name: 'echo',
    description: 'Echoes input',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    handler: async (args) => args.text as string,
  });
});

afterAll(() => closeDb());

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter);
  return app;
}

function rpc(method: string, params?: unknown, id = 1) {
  return { jsonrpc: '2.0', method, params, id };
}

describe('MCP server', () => {
  it('rejects missing auth', async () => {
    const res = await request(makeApp()).post('/mcp').send(rpc('initialize'));
    expect(res.status).toBe(401);
  });

  it('handles initialize', async () => {
    const token = generateMcpToken('u1');
    const res = await request(makeApp())
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} }));
    expect(res.status).toBe(200);
    expect(res.body.result.capabilities).toBeDefined();
  });

  it('lists registered tools', async () => {
    const token = generateMcpToken('u1');
    const res = await request(makeApp())
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(rpc('tools/list'));
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as Array<{ name: string }>;
    expect(tools.some(t => t.name === 'echo')).toBe(true);
  });

  it('calls a registered tool', async () => {
    const token = generateMcpToken('u1');
    const res = await request(makeApp())
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(rpc('tools/call', { name: 'echo', arguments: { text: 'hello' } }));
    expect(res.status).toBe(200);
    expect(res.body.result.content[0].text).toBe('hello');
  });

  it('returns error for unknown tool', async () => {
    const token = generateMcpToken('u1');
    const res = await request(makeApp())
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(rpc('tools/call', { name: 'nope', arguments: {} }));
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
  });
});
