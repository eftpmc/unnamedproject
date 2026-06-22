import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../src/lib/mcp-pool.js', () => ({
  listMcpTools: vi.fn(async () => [
    { name: 'create_pr', description: 'Create a pull request', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  ]),
  callMcpTool: vi.fn(async () => 'PR #42 created'),
}));

vi.mock('../../src/routes/connections.js', () => ({
  getDecryptedConfig: vi.fn(() => ({ command: 'mock-mcp', args: '[]', env: '{}' })),
}));

describe('toolRegistry', () => {
  let dataDir: string;
  const userId = 'user-1';
  const connId = 'conn-1';

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-registry-svc-test-'));
    process.env.DATA_DIR = dataDir;
    process.env.MASTER_KEY = 'test-master-key-32-bytes-long!!';
    const { initDb, getDb } = await import('../../src/db/index.js');
    initDb();
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, 'a@b.com', 'x');
    getDb().prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)").run(connId, userId, 'gh-mcp', 'mcp', 'enc');
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests MCP tools into the registry', async () => {
    const { ingestMcpTools, getRegistrySearchPool } = await import('../../src/services/toolRegistry.js');
    await ingestMcpTools(userId, connId);

    const pool = getRegistrySearchPool(userId);
    expect(pool).toHaveLength(1);
    expect(pool[0].description).toContain('Create a pull request');
  });

  it('resolves a registered tool by its qualified name with the real input schema', async () => {
    const { ingestMcpTools, getRegistrySearchPool, resolveRegistryTool } = await import('../../src/services/toolRegistry.js');
    await ingestMcpTools(userId, connId);
    const pool = getRegistrySearchPool(userId);
    const qualifiedName = (await import('../../src/db/index.js')).getMcpRegistryToolsForUser(userId)[0].tool_name;

    const tool = resolveRegistryTool(userId, qualifiedName);
    expect(tool?.name).toBe(qualifiedName);
    expect(tool?.input_schema).toEqual({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] });
  });

  it('dispatches a registered tool call through callMcpTool', async () => {
    const { ingestMcpTools, dispatchRegistryTool } = await import('../../src/services/toolRegistry.js');
    await ingestMcpTools(userId, connId);
    const qualifiedName = (await import('../../src/db/index.js')).getMcpRegistryToolsForUser(userId)[0].tool_name;

    const result = await dispatchRegistryTool(userId, qualifiedName, { title: 'fix bug' });
    expect(result).toBe('PR #42 created');
  });

  it('returns undefined for a name not in the registry', async () => {
    const { dispatchRegistryTool } = await import('../../src/services/toolRegistry.js');
    const result = await dispatchRegistryTool(userId, 'not_a_real_tool', {});
    expect(result).toBeUndefined();
  });

  it('throws a clear, actionable error when ingestMcpTools hits malformed args JSON', async () => {
    const { getDecryptedConfig } = await import('../../src/routes/connections.js');
    (getDecryptedConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      command: 'mock-mcp',
      args: '{not valid json',
      env: '{}',
    });

    const { ingestMcpTools } = await import('../../src/services/toolRegistry.js');
    await expect(ingestMcpTools(userId, connId)).rejects.toThrow(
      new RegExp(`Malformed MCP connection config.*"args".*${connId}`),
    );
  });

  it('throws a clear, actionable error when ingestMcpTools hits malformed env JSON', async () => {
    const { getDecryptedConfig } = await import('../../src/routes/connections.js');
    (getDecryptedConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      command: 'mock-mcp',
      args: '[]',
      env: '{not valid json',
    });

    const { ingestMcpTools } = await import('../../src/services/toolRegistry.js');
    await expect(ingestMcpTools(userId, connId)).rejects.toThrow(
      new RegExp(`Malformed MCP connection config.*"env".*${connId}`),
    );
  });

  it('throws a clear, actionable error when dispatchRegistryTool hits malformed config JSON', async () => {
    const { ingestMcpTools, dispatchRegistryTool } = await import('../../src/services/toolRegistry.js');
    await ingestMcpTools(userId, connId);
    const qualifiedName = (await import('../../src/db/index.js')).getMcpRegistryToolsForUser(userId)[0].tool_name;

    const { getDecryptedConfig } = await import('../../src/routes/connections.js');
    (getDecryptedConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      command: 'mock-mcp',
      args: '[invalid',
      env: '{}',
    });

    await expect(dispatchRegistryTool(userId, qualifiedName, {})).rejects.toThrow(
      new RegExp(`Malformed MCP connection config.*"args".*${connId}`),
    );
  });
});
