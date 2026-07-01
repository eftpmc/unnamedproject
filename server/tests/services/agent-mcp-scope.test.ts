import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { closeDb, getDb, initDb } from '../../src/db/index.js';
import { createConnectionRecord } from '../../src/routes/connections.js';

const DATA_DIR = process.env.DATA_DIR!;

const mockInvoke = vi.fn().mockImplementation(async (params) => {
  params.onText('done');
  params.onSessionId('provider-session');
  return { costUsd: 0, executionId: 'exec-scope' };
});

vi.mock('../../src/services/conversation-provider.js', () => ({
  getConversationProvider: vi.fn().mockResolvedValue({
    type: 'claude_code',
    invoke: mockInvoke,
    resolveModel: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
  }),
}));
vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));
vi.mock('../../src/mcp/auth.js', () => ({ generateMcpToken: vi.fn().mockReturnValue('mcp-token') }));

beforeEach(() => {
  closeDb();
  fs.rmSync(path.join(DATA_DIR, 'app.db'), { force: true });
  initDb(DATA_DIR);
  mockInvoke.mockClear();
  getDb().prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u-scope','scope@test.com','x')").run();
});

afterAll(() => closeDb());

function seedTurn(sessionId: string, messageId: string, pinnedProjectId?: string): void {
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, pinned_project_id) VALUES (?, ?, ?)')
    .run(sessionId, 'u-scope', pinnedProjectId ?? null);
  getDb()
    .prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, 'user', 'use tools')")
    .run(messageId, sessionId);
  getDb()
    .prepare("INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES (?, ?, ?, 'running')")
    .run(`turn-${sessionId}`, sessionId, messageId);
}

function seedGitRepo(label: string): string {
  const repoPath = fs.mkdtempSync(path.join(DATA_DIR, label));
  execFileSync('git', ['init'], { cwd: repoPath });
  execFileSync('git', ['config', 'user.email', 'scope@test.local'], { cwd: repoPath });
  execFileSync('git', ['config', 'user.name', 'Scope Test'], { cwd: repoPath });
  return repoPath;
}

describe('agent MCP scoping', () => {
  it('does not inject user MCP connections into unpinned sessions', async () => {
    createConnectionRecord('u-scope', {
      name: 'Search MCP',
      type: 'mcp',
      purpose: 'mcp',
      config: { command: 'node', args: JSON.stringify(['search.js']), env: '{}' },
    });
    seedTurn('s-unpinned', 'm-unpinned');

    const { runAgentTurn } = await import('../../src/services/agent.js');
    await runAgentTurn('u-scope', 's-unpinned', 'm-unpinned');

    const mcpServers = mockInvoke.mock.calls[0][0].mcpServers;
    expect(Object.keys(mcpServers)).toEqual(['app']);
    expect(mcpServers.app.headers.Authorization).toBe('Bearer mcp-token');
  });

  it('injects only MCP connections enabled for the pinned project', async () => {
    const enabled = createConnectionRecord('u-scope', {
      name: 'Search MCP',
      type: 'mcp',
      purpose: 'mcp',
      config: { command: 'node', args: JSON.stringify(['search.js']), env: JSON.stringify({ TOKEN: 'scoped' }) },
    });
    createConnectionRecord('u-scope', {
      name: 'Private MCP',
      type: 'mcp',
      purpose: 'mcp',
      config: { command: 'node', args: JSON.stringify(['private.js']), env: '{}' },
    });

    const repoPath = seedGitRepo('scope-repo-');
    getDb()
      .prepare('INSERT INTO projects (id, user_id, name, repo_path, origin, enabled_connection_ids) VALUES (?, ?, ?, ?, ?, ?)')
      .run('p-scope', 'u-scope', 'Scoped Project', repoPath, 'linked', JSON.stringify([enabled.id]));
    seedTurn('s-pinned', 'm-pinned', 'p-scope');

    const { runAgentTurn } = await import('../../src/services/agent.js');
    await runAgentTurn('u-scope', 's-pinned', 'm-pinned');

    const mcpServers = mockInvoke.mock.calls[0][0].mcpServers;
    expect(Object.keys(mcpServers).sort()).toEqual(['app', 'search_mcp']);
    expect(mcpServers.search_mcp).toMatchObject({
      command: 'node',
      args: ['search.js'],
      env: { TOKEN: 'scoped' },
    });
    expect(mcpServers.private_mcp).toBeUndefined();
  });
});
