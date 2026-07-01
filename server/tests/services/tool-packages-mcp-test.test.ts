import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const listMcpTools = vi.fn();
const closeMcpConnection = vi.fn();

vi.mock('../../src/lib/mcp-pool.js', () => ({
  listMcpTools,
  closeMcpConnection,
}));

const { closeDb, getDb, initDb } = await import('../../src/db/index.js');
const { createOrUpdateToolPackage, testToolPackage } = await import('../../src/services/tool-packages.js');

const DATA_DIR = process.env.DATA_DIR!;
const userId = 'u-tool-test';

beforeEach(() => {
  closeDb();
  fs.rmSync(path.join(DATA_DIR, 'app.db'), { force: true });
  initDb(DATA_DIR);
  getDb().prepare("INSERT INTO users (id, email, hashed_password) VALUES (?, ?, 'x')").run(userId, 'tool-test@test.com');
  listMcpTools.mockReset();
  closeMcpConnection.mockReset();
});

afterAll(() => closeDb());

describe('tool package MCP dry run', () => {
  it('runs tools/list against the package entrypoint without installing a connection', async () => {
    listMcpTools.mockResolvedValueOnce([
      { name: 'convert_pdf', description: 'Convert a PDF', inputSchema: { type: 'object', properties: {} } },
    ]);
    const pkg = await createOrUpdateToolPackage({
      userId,
      manifest: {
        name: 'dry-run-tool',
        runtime: 'node',
        entry: 'server.js',
        permissions: { filesystem: ['session'], network: false, secrets: [], subprocess: [] },
      },
      files: [{ path: 'server.js', content: 'console.log("mcp")\n' }],
    });

    const result = await testToolPackage(userId, pkg.id);

    expect(result.ok).toBe(true);
    expect(result.tools.map(t => t.name)).toEqual(['convert_pdf']);
    expect(listMcpTools).toHaveBeenCalledTimes(1);
    const [, command, args, env, cwd] = listMcpTools.mock.calls[0];
    expect(command).toBe('node');
    expect(args).toEqual([path.join(pkg.package_path, 'server.js')]);
    expect(env.UNNAMED_TOOL_PACKAGE_NAME).toBe('dry-run-tool');
    expect(cwd).toBe(pkg.package_path);
    expect(closeMcpConnection).toHaveBeenCalledWith(expect.stringMatching(/^tool-package-test:/));
    const count = (getDb().prepare('SELECT COUNT(*) as c FROM connections WHERE user_id = ?').get(userId) as { c: number }).c;
    expect(count).toBe(0);
  });

  it('marks the package error when the MCP handshake fails', async () => {
    listMcpTools.mockRejectedValueOnce(new Error('initialize failed'));
    const pkg = await createOrUpdateToolPackage({
      userId,
      manifest: { name: 'broken-mcp-tool', runtime: 'python', entry: 'server.py' },
      files: [{ path: 'server.py', content: 'print("not mcp")\n' }],
    });

    const result = await testToolPackage(userId, pkg.id);

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('MCP test failed: initialize failed');
    expect(result.package?.status).toBe('error');
    expect(result.package?.last_error).toContain('initialize failed');
    expect(closeMcpConnection).toHaveBeenCalledWith(expect.stringMatching(/^tool-package-test:/));
  });
});
