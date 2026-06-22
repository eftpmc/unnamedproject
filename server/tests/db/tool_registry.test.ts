import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('tool_registry', () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-registry-test-'));
    process.env.DATA_DIR = dataDir;
    process.env.MASTER_KEY = 'test-master-key-32-bytes-long!!';
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('upserts MCP tools and resolves them by qualified name', async () => {
    const { initDb, getDb, upsertMcpRegistryTools, getMcpRegistryToolsForUser, getMcpRegistryTool } = await import('../../src/db/index.js');
    initDb();
    const userId = 'user-1';
    const connId = 'conn-1';
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, 'a@b.com', 'x');
    getDb().prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)").run(connId, userId, 'gh-mcp', 'mcp', 'enc');

    upsertMcpRegistryTools(userId, connId, [
      { name: 'create_pr', description: 'Create a pull request', inputSchema: { type: 'object', properties: {} } },
    ]);

    const tools = getMcpRegistryToolsForUser(userId);
    expect(tools).toHaveLength(1);
    expect(tools[0].mcp_tool_name).toBe('create_pr');

    const resolved = getMcpRegistryTool(userId, tools[0].tool_name);
    expect(resolved?.connection_id).toBe(connId);
  });

  it('upserting the same MCP tool again updates rather than duplicates', async () => {
    const { getDb, upsertMcpRegistryTools, getMcpRegistryToolsForUser } = await import('../../src/db/index.js');
    const userId = 'user-1';
    const connId = 'conn-1';

    upsertMcpRegistryTools(userId, connId, [
      { name: 'create_pr', description: 'Create a PR (updated)', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } },
    ]);

    const tools = getMcpRegistryToolsForUser(userId);
    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe('Create a PR (updated)');
  });

  it('tracks discovered tools per session, deduplicated', async () => {
    const { getDb, addSessionDiscoveredTools, getSessionDiscoveredTools } = await import('../../src/db/index.js');
    const userId = 'user-1';
    const sessionId = 'session-1';
    getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);

    addSessionDiscoveredTools(sessionId, ['read_file', 'tool_search']);
    addSessionDiscoveredTools(sessionId, ['read_file', 'mcp_abc123_create_pr']);

    expect(getSessionDiscoveredTools(sessionId).sort()).toEqual(['mcp_abc123_create_pr', 'read_file', 'tool_search'].sort());
  });
});
