import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';
import mcpRouter from '../../src/mcp/index.js';
import { generateMcpToken } from '../../src/mcp/auth.js';
import { createOrUpdateToolPackage, installToolPackage } from '../../src/services/tool-packages.js';
import { resolveApproval } from '../../src/lib/approval.js';

vi.mock('../../src/lib/mcp-pool.js', () => ({
  listMcpTools: vi.fn().mockResolvedValue([
    { name: 'event_tool', description: 'Event test tool', inputSchema: { type: 'object', properties: {} } },
  ]),
  closeMcpConnection: vi.fn(),
  closeMcpConnections: vi.fn(),
}));

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

describe('checkpoint_session handler', () => {
  it('saves structured state to the session', async () => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO sessions (id, user_id) VALUES ('s-cp','u-mcp')").run();
    const token = generateMcpToken(userId, 's-cp');
    const res = await call(makeApp(), 'checkpoint_session', {
      completed: 'Implemented the login flow',
      open_tasks: ['Write tests', 'Update docs'],
      next_action: 'Run the test suite',
      files_changed: ['src/auth.ts'],
    }, token);
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(res.body.result.content[0].text).toContain('checkpoint saved');

    const row = db.prepare('SELECT session_state FROM sessions WHERE id = ?').get('s-cp') as { session_state: string | null };
    const state = JSON.parse(row.session_state ?? '{}');
    expect(state.facts).toContain('Implemented the login flow');
    expect(state.open_tasks).toContain('Write tests');
    expect(state.next_action).toBe('Run the test suite');
    expect(state.files_touched).toContain('src/auth.ts');
  });

  it('returns a safe message when called without a session', async () => {
    const token = generateMcpToken(userId);
    const res = await call(makeApp(), 'checkpoint_session', { completed: 'Done' }, token);
    expect(res.status).toBe(200);
    expect(res.body.result.content[0].text).toContain('No active session');
  });
});

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

describe('tool package connection protection', () => {
  it('does not let delete_connection remove generated tool package connections', async () => {
    const pkg = await createOrUpdateToolPackage({
      userId,
      manifest: { name: 'delete-guard', runtime: 'node', entry: 'server.js' },
      files: [{ path: 'server.js', content: 'console.log("mcp")\n' }],
    });
    const installed = await installToolPackage(userId, pkg.id);
    const token = generateMcpToken(userId);
    const res = await call(makeApp(), 'delete_connection', { connection_id: installed.connection_id }, token);
    expect(res.status).toBe(200);
    expect(res.body.result.content[0].text).toContain('disable_tool_package');

    const row = getDb().prepare('SELECT id FROM connections WHERE id = ?').get(installed.connection_id);
    expect(row).toBeTruthy();
  });
});

describe('tool package session events', () => {
  it('records install and disable events when package lifecycle runs from a session', async () => {
    const db = getDb();
    const repoPath = fs.mkdtempSync(path.join(DATA_DIR, 'tool-events-repo-'));
    db.prepare("INSERT INTO projects (id, user_id, name, repo_path, origin) VALUES ('p-tool-events','u-mcp','Tool Events',?,'linked')").run(repoPath);
    db.prepare("INSERT OR IGNORE INTO sessions (id, user_id, pinned_project_id) VALUES ('s-tool-events','u-mcp','p-tool-events')").run();
    const pkg = await createOrUpdateToolPackage({
      userId,
      manifest: { name: 'event-tool', description: 'A test tool', runtime: 'node', entry: 'server.js' },
      files: [{ path: 'server.js', content: 'console.log("mcp")\n' }],
      sourceSessionId: 's-tool-events',
    });
    const token = generateMcpToken(userId, 's-tool-events');
    const app = makeApp();

    const installPromise = Promise.resolve(call(app, 'request_tool_install', { package_id: pkg.id, reason: 'Needed for the test flow' }, token));
    await vi.waitFor(() => {
      const row = db.prepare("SELECT id FROM approvals WHERE action = 'install_tool_package' AND status = 'pending'").get();
      expect(row).toBeTruthy();
    });
    const installApproval = db.prepare("SELECT id FROM approvals WHERE action = 'install_tool_package' AND status = 'pending'").get() as { id: string };
    resolveApproval(installApproval.id, 'approved');
    const installRes = await installPromise;
    expect(installRes.body.result.content[0].text).toContain('event-tool');
    const installedPackage = JSON.parse(installRes.body.result.content[0].text) as { connection_id: string };
    const project = db.prepare('SELECT enabled_connection_ids FROM projects WHERE id = ?').get('p-tool-events') as { enabled_connection_ids: string };
    expect(JSON.parse(project.enabled_connection_ids)).toContain(installedPackage.connection_id);

    const installEvent = db.prepare("SELECT title, metadata FROM session_events WHERE session_id = ? AND type = 'connection_created' ORDER BY created_at DESC LIMIT 1")
      .get('s-tool-events') as { title: string; metadata: string };
    expect(installEvent.title).toBe('Installed tool package: event-tool');
    expect(JSON.parse(installEvent.metadata)).toMatchObject({ kind: 'tool_package', action: 'installed' });

    const disablePromise = Promise.resolve(call(app, 'disable_tool_package', { package_id: pkg.id }, token));
    await vi.waitFor(() => {
      const row = db.prepare("SELECT id FROM approvals WHERE action = 'disable_tool_package' AND status = 'pending'").get();
      expect(row).toBeTruthy();
    });
    const disableApproval = db.prepare("SELECT id FROM approvals WHERE action = 'disable_tool_package' AND status = 'pending'").get() as { id: string };
    resolveApproval(disableApproval.id, 'approved');
    const disableRes = await disablePromise;
    expect(disableRes.body.result.content[0].text).toContain('disabled');

    const disableEvent = db.prepare("SELECT title, metadata FROM session_events WHERE session_id = ? AND type = 'runtime_checkpoint' ORDER BY created_at DESC LIMIT 1")
      .get('s-tool-events') as { title: string; metadata: string };
    expect(disableEvent.title).toBe('Disabled tool package: event-tool');
    expect(JSON.parse(disableEvent.metadata)).toMatchObject({ kind: 'tool_package', action: 'disabled' });
  });
});
