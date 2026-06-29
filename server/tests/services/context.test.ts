import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { buildContext } from '../../src/services/context.js';
import { DEFAULT_INTENT } from '../../src/services/intent.js';
import type { Intent } from '../../src/services/intent.js';

const userId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `ctx-${userId}@test.com`, 'x');
  sessionId = newId();
  getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
});

const codeIntent: Intent = { ...DEFAULT_INTENT, domain: 'code' };
const writingIntent: Intent = { ...DEFAULT_INTENT, domain: 'writing' };
const researchIntent: Intent = { ...DEFAULT_INTENT, domain: 'research' };

function makeProject(name: string, description?: string): { spaceId: string; projectId: string } {
  const spaceId = newId();
  const projectId = newId();
  getDb()
    .prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
    .run(spaceId, userId, name, description ?? null, '[]');
  getDb()
    .prepare('INSERT INTO projects (id, space_id, user_id, name, repo_path, default_branch, origin, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(projectId, spaceId, userId, name, `/tmp/${projectId}`, null, 'linked', Math.floor(Date.now() / 1000));
  return { spaceId, projectId };
}

describe('buildContext', () => {
  it('always includes base identity and approval tier content', async () => {
    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('personal AI assistant');
    expect(ctx).toContain('Auto-approved');
  });

  it('always includes research discipline block', async () => {
    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('Research discipline');
    expect(ctx).toContain('Web search');
  });

  it('includes browser retry-loop guardrail', async () => {
    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('do not retry the same action');
    expect(ctx).toContain('continue from the checkpoint');
  });

  it('includes worktree isolation guidance for code domain', async () => {
    const ctx = await buildContext(userId, sessionId, codeIntent, '');
    expect(ctx).toContain('worktree');
    expect(ctx).toContain('git_op');
  });

  it('includes write_document guidance for writing domain', async () => {
    const ctx = await buildContext(userId, sessionId, writingIntent, '');
    expect(ctx).toContain('write_document');
    expect(ctx).toContain('Do not invoke coding agents');
  });

  it('includes citation guidance for research domain', async () => {
    const ctx = await buildContext(userId, sessionId, researchIntent, '');
    expect(ctx).toContain('Cite');
  });

  it('omits agent usage block for non-code, non-multi domains', async () => {
    const ctx = await buildContext(userId, sessionId, writingIntent, '');
    expect(ctx).not.toContain('## Agent usage');
  });

  it('includes session summary when present', async () => {
    getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run('Earlier we discussed auth', sessionId);
    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('Earlier we discussed auth');
    getDb().prepare('UPDATE sessions SET summary = NULL WHERE id = ?').run(sessionId);
  });

  it('includes structured session state when present', async () => {
    getDb()
      .prepare('UPDATE sessions SET session_state = ? WHERE id = ?')
      .run(JSON.stringify({
        goal: 'Organize internship applications',
        facts: ['Created index.md'],
        decisions: [],
        open_tasks: ['Verify remaining dates'],
        blockers: [],
        artifacts: ['index.md'],
        failed_attempts: [],
        next_action: 'Update docs',
        updated_at: 1,
      }), sessionId);

    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('Structured session state');
    expect(ctx).toContain('Organize internship applications');
    expect(ctx).toContain('index.md');

    getDb().prepare('UPDATE sessions SET session_state = NULL WHERE id = ?').run(sessionId);
  });

  it('includes project name and id in project context', async () => {
    const { projectId } = makeProject('sandbox-demo', 'A sandbox project');
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('sandbox-demo');
    expect(ctx).toContain(projectId);

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
  });

  it('project context block does not reference a project type label', async () => {
    const { projectId } = makeProject('type-check-project', 'Testing no type label');
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).not.toMatch(/type:\s*(default|video)/);

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
  });

  it('includes document guidance for a Space with no projects or documents', async () => {
    const { projectId, spaceId } = makeProject('empty-project');
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toMatch(/create_project|write_document|No projects/);

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    getDb().prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
  });

  it('defers pinned project CLAUDE.md and AGENTS.md to provider-native loading', async () => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-instructions-'));
    fs.writeFileSync(path.join(repoPath, 'CLAUDE.md'), 'Claude project instruction: always use app MCP tools.');
    fs.writeFileSync(path.join(repoPath, 'AGENTS.md'), 'Agents project instruction: keep context compact.');

    const { projectId } = makeProject('instruction-project');
    getDb().prepare('UPDATE projects SET repo_path = ? WHERE id = ?').run(repoPath, projectId);
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('Agent instruction files');
    expect(ctx).toContain('loaded natively by Claude Code/Codex');
    expect(ctx).not.toContain('Claude project instruction');
    expect(ctx).not.toContain('Agents project instruction');

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
    fs.rmSync(repoPath, { recursive: true, force: true });
  });
});
