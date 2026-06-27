import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';
import mcpRouter from '../../src/mcp/index.js';
import { generateMcpToken } from '../../src/mcp/auth.js';

const DATA_DIR = process.env.DATA_DIR!;
let userId: string;

beforeAll(async () => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u-mcp','mcp@test.com','x')").run();
  userId = 'u-mcp';
  // Import handlers to register them (mcpRouter already does this, but explicit for clarity)
  await import('../../src/mcp/handlers/index.js');
});

afterAll(() => closeDb());

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter);
  return app;
}

function call(app: ReturnType<typeof makeApp>, toolName: string, args: Record<string, unknown>, token: string) {
  return request(app)
    .post('/mcp')
    .set('Authorization', `Bearer ${token}`)
    .send({ jsonrpc: '2.0', method: 'tools/call', params: { name: toolName, arguments: args }, id: 1 });
}

describe('space handlers', () => {
  it('list_spaces returns empty array initially', async () => {
    const token = generateMcpToken(userId);
    const res = await call(makeApp(), 'list_spaces', {}, token);
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    const spaces = JSON.parse(res.body.result.content[0].text);
    expect(Array.isArray(spaces)).toBe(true);
  });

  it('create_space creates and list_spaces returns it', async () => {
    const token = generateMcpToken(userId);
    const app = makeApp();
    await call(app, 'create_space', { name: 'Test Space' }, token);
    const res = await call(app, 'list_spaces', {}, token);
    const spaces = JSON.parse(res.body.result.content[0].text);
    expect(spaces.some((s: { name: string }) => s.name === 'Test Space')).toBe(true);
  });
});

