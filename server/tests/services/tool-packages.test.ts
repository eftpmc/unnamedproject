import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { closeDb, getDb, initDb } from '../../src/db/index.js';
import { createOrUpdateToolPackage, disableToolPackage, installToolPackage, listToolPackages, validateToolPackage } from '../../src/services/tool-packages.js';
import { createConnectionRecord, getDecryptedConfig } from '../../src/routes/connections.js';

const DATA_DIR = process.env.DATA_DIR!;
const userId = 'u-tools';

beforeEach(() => {
  closeDb();
  fs.rmSync(path.join(DATA_DIR, 'app.db'), { force: true });
  initDb(DATA_DIR);
  getDb().prepare("INSERT INTO users (id, email, hashed_password) VALUES (?, ?, 'x')").run(userId, 'tools@test.com');
  getDb().prepare("INSERT INTO sessions (id, user_id) VALUES ('s1', ?)").run(userId);
});

afterAll(() => closeDb());

function manifest(name = 'pdf-tool') {
  return {
    name,
    description: 'Render PDFs from markdown',
    runtime: 'python',
    entry: 'server.py',
    scope: 'project',
    permissions: {
      filesystem: ['session', 'project_files'],
      network: false,
      secrets: [],
      subprocess: ['python3'],
    },
  };
}

describe('tool packages', () => {
  it('creates package files inside the managed tools directory and validates the entrypoint', async () => {
    const pkg = await createOrUpdateToolPackage({
      userId,
      manifest: manifest(),
      files: [{ path: 'server.py', content: 'print("mcp")\n' }],
      sourceSessionId: 's1',
    });

    expect(pkg.name).toBe('pdf-tool');
    expect(pkg.status).toBe('draft');
    expect(pkg.package_path).toContain(path.join(DATA_DIR, 'tools', userId, 'pdf-tool'));
    expect(fs.existsSync(path.join(pkg.package_path, 'tool-package.json'))).toBe(true);

    const validation = await validateToolPackage(userId, pkg.id);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('rejects files that escape the package directory', async () => {
    await expect(createOrUpdateToolPackage({
      userId,
      manifest: manifest('bad-tool'),
      files: [{ path: '../server.py', content: 'print("bad")\n' }],
    })).rejects.toThrow(/escapes/);
  });

  it('rejects unsupported permission labels in manifests', async () => {
    await expect(createOrUpdateToolPackage({
      userId,
      manifest: {
        ...manifest('bad-permissions'),
        permissions: { filesystem: ['~/Documents'], network: false, secrets: [], subprocess: [] },
      },
      files: [{ path: 'server.py', content: 'print("bad")\n' }],
    })).rejects.toThrow(/Unsupported filesystem permission/);
  });

  it('rejects secret and subprocess permissions that are not capability names', async () => {
    await expect(createOrUpdateToolPackage({
      userId,
      manifest: {
        ...manifest('bad-secret'),
        permissions: { filesystem: ['session'], network: false, secrets: ['anthropic-key'], subprocess: [] },
      },
      files: [{ path: 'server.py', content: 'print("bad")\n' }],
    })).rejects.toThrow(/uppercase environment variable/);

    await expect(createOrUpdateToolPackage({
      userId,
      manifest: {
        ...manifest('bad-subprocess'),
        permissions: { filesystem: ['session'], network: false, secrets: [], subprocess: ['/bin/sh'] },
      },
      files: [{ path: 'server.py', content: 'print("bad")\n' }],
    })).rejects.toThrow(/command name/);
  });

  it('installs a validated package as an MCP connection and disables it by removing the connection', async () => {
    const pkg = await createOrUpdateToolPackage({
      userId,
      manifest: manifest('installable-tool'),
      files: [{ path: 'server.py', content: 'print("mcp")\n' }],
    });

    const installed = await installToolPackage(userId, pkg.id);
    expect(installed.status).toBe('installed');
    expect(installed.connection_id).toBeTruthy();

    const cfg = getDecryptedConfig(installed.connection_id!, userId);
    expect(cfg.command).toBe('python3');
    expect(JSON.parse(cfg.args)).toEqual([path.join(installed.package_path, 'server.py')]);
    expect(cfg.cwd).toBe(installed.package_path);
    expect(JSON.parse(cfg.env)).toMatchObject({
      UNNAMED_TOOL_PACKAGE_ID: installed.id,
      UNNAMED_TOOL_PACKAGE_NAME: 'installable-tool',
      UNNAMED_TOOL_NETWORK_ALLOWED: '0',
    });

    const disabled = disableToolPackage(userId, pkg.id);
    expect(disabled.status).toBe('disabled');
    expect(disabled.connection_id).toBeNull();
    const count = (getDb().prepare('SELECT COUNT(*) as c FROM connections WHERE user_id = ?').get(userId) as { c: number }).c;
    expect(count).toBe(0);
  });

  it('removes the generated connection when an installed package is updated', async () => {
    const pkg = await createOrUpdateToolPackage({
      userId,
      manifest: manifest('update-installed-tool'),
      files: [{ path: 'server.py', content: 'print("v1")\n' }],
    });
    const installed = await installToolPackage(userId, pkg.id);
    expect(installed.connection_id).toBeTruthy();

    const updated = await createOrUpdateToolPackage({
      userId,
      manifest: { ...manifest('update-installed-tool'), description: 'Updated package' },
      files: [{ path: 'server.py', content: 'print("v2")\n' }],
    });

    expect(updated.id).toBe(pkg.id);
    expect(updated.status).toBe('draft');
    expect(updated.connection_id).toBeNull();
    const oldConn = getDb().prepare('SELECT id FROM connections WHERE id = ?').get(installed.connection_id!);
    expect(oldConn).toBeUndefined();

    const reinstalled = await installToolPackage(userId, updated.id);
    expect(reinstalled.status).toBe('installed');
    expect(reinstalled.connection_id).toBeTruthy();
    expect(reinstalled.connection_id).not.toBe(installed.connection_id);
  });

  it('lists packages without exposing connection secrets', async () => {
    await createOrUpdateToolPackage({
      userId,
      manifest: manifest('listed-tool'),
      files: [{ path: 'server.py', content: 'print("mcp")\n' }],
    });

    const packages = listToolPackages(userId);
    expect(packages.map(p => p.name)).toContain('listed-tool');
  });

  it('prevents generic callers from creating reserved tool package connections', () => {
    expect(() => createConnectionRecord(userId, {
      name: 'tool:manual-bypass',
      type: 'mcp',
      purpose: 'mcp',
      config: { command: 'node', args: '[]', env: '{}' },
    })).toThrow(/managed by tool packages/);
  });
});
