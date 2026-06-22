import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb, recordAgentUsage, setAgentBudget } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { buildContext, getToolSubset } from '../../src/services/context.js';
import { DEFAULT_INTENT } from '../../src/services/intent.js';
import type { Intent } from '../../src/services/intent.js';
import { toolDefinitions } from '../../src/tools/definitions.js';

const userId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `ctx-${userId}@test.com`, 'x');
  sessionId = newId();
  getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
});

const codeIntent: Intent = { ...DEFAULT_INTENT, domain: 'code', scope: 'delegate' };
const writingIntent: Intent = { ...DEFAULT_INTENT, domain: 'writing', scope: 'inline' };
const researchIntent: Intent = { ...DEFAULT_INTENT, domain: 'research', scope: 'inline' };

describe('buildContext', () => {
  it('always includes base identity and approval tier content', () => {
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('orchestrator');
    expect(ctx).toContain('auto-approved');
  });

  it('always includes research discipline block', () => {
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('Research discipline');
    expect(ctx).toContain('Web search and fetch are provided by MCP servers');
    expect(ctx).toContain('tool_search');
  });

  it('includes worktree isolation guidance for code domain', () => {
    const ctx = buildContext(userId, sessionId, codeIntent);
    expect(ctx).toContain('worktree');
    expect(ctx).toContain('invoke_claude_code');
  });

  it('includes write_file guidance for writing domain', () => {
    const ctx = buildContext(userId, sessionId, writingIntent);
    expect(ctx).toContain('write_file');
    // The always-on core rules reference the coding-agent commit protocol, but the
    // writing domain guidance must steer away from delegating to coding agents.
    expect(ctx).toContain('Do not invoke coding agents');
  });

  it('includes citation guidance for research domain', () => {
    const ctx = buildContext(userId, sessionId, researchIntent);
    expect(ctx).toContain('Cite');
  });

  it('includes agent usage block for code domain, reflecting budgets and spend', () => {
    setAgentBudget(userId, 'claude_code', 20);
    recordAgentUsage(userId, 'claude_code', 5);
    recordAgentUsage(userId, 'codex', 1.5);

    const ctx = buildContext(userId, sessionId, codeIntent);
    expect(ctx).toContain('## Agent usage');
    expect(ctx).toContain('Claude Code (invoke_claude_code): $5.00 / $20.00 used this month (25%); $5.00 spent today (no daily budget)');
    expect(ctx).toContain('Codex (invoke_codex): $1.50 spent (no monthly budget); $1.50 spent today (no daily budget)');
  });

  it('omits agent usage block for non-code, non-multi domains', () => {
    const ctx = buildContext(userId, sessionId, writingIntent);
    expect(ctx).not.toContain('## Agent usage');
  });

  it('includes session summary when present', () => {
    getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run('Earlier we discussed auth', sessionId);
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('Earlier we discussed auth');
    getDb().prepare('UPDATE sessions SET summary = NULL WHERE id = ?').run(sessionId);
  });

  it('includes project name and id in project context', () => {
    const projectId = newId();
    getDb()
      .prepare('INSERT INTO projects (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'sandbox-demo', 'A sandbox project', '[]');
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('sandbox-demo');
    expect(ctx).toContain(projectId);

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
  });

  it('project context block does not reference a project type label', () => {
    const projectId = newId();
    getDb()
      .prepare('INSERT INTO projects (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'type-check-project', 'Testing no type label', '[]');
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).not.toMatch(/type:\s*(default|video)/);

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
  });

  it('includes workspace.md content in project context when file exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
    const workspaceContent = '## Goals\n- Build the login flow\n\n## Done\n- DB schema migration';
    fs.writeFileSync(path.join(tmpDir, 'workspace.md'), workspaceContent);

    const projectId = newId();
    getDb()
      .prepare('INSERT INTO projects (id, user_id, name, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'ws-project', tmpDir, '[]');
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('Build the login flow');
    expect(ctx).toContain('DB schema migration');

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes workspace.md hint when no file exists', () => {
    const projectId = newId();
    getDb()
      .prepare('INSERT INTO projects (id, user_id, name, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'no-ws-project', '/tmp/nonexistent-repo-path', '[]');
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('workspace.md');

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  });
});

describe('getToolSubset', () => {
  it('code domain includes invoke_claude_code and git_op', () => {
    const tools = getToolSubset(codeIntent);
    const names = tools.map(t => t.name);
    expect(names).toContain('invoke_claude_code');
    expect(names).toContain('git_op');
  });

  it('code domain includes MCP discovery tools for external research', () => {
    const tools = getToolSubset(codeIntent);
    const names = tools.map(t => t.name);
    expect(names).toContain('list_connections');
    expect(names).toContain('tool_search');
  });

  it('writing domain excludes invoke_claude_code', () => {
    const tools = getToolSubset(writingIntent);
    expect(tools.map(t => t.name)).not.toContain('invoke_claude_code');
  });

  it('research domain excludes invoke_claude_code and git_op', () => {
    const tools = getToolSubset(researchIntent);
    const names = tools.map(t => t.name);
    expect(names).not.toContain('invoke_claude_code');
    expect(names).not.toContain('git_op');
  });

  it('general domain returns all tools', () => {
    const tools = getToolSubset(DEFAULT_INTENT); // domain=general
    expect(tools.length).toBe(toolDefinitions.length);
  });

  it('multi domain returns all tools', () => {
    const multiIntent: Intent = { ...DEFAULT_INTENT, domain: 'multi' };
    const tools = getToolSubset(multiIntent);
    expect(tools.length).toBe(toolDefinitions.length);
  });
});
