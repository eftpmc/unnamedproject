import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { buildContext } from '../../src/services/context.js';

const userId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `ctx-${userId}@test.com`, 'x');
  sessionId = newId();
  getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
});

function makeProject(name: string, description?: string): string {
  const projectId = newId();
  getDb()
    .prepare('INSERT INTO projects (id, user_id, name, description, repo_path, default_branch, origin, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(projectId, userId, name, description ?? null, `/tmp/${projectId}`, null, 'linked', Math.floor(Date.now() / 1000));
  return projectId;
}

describe('buildContext', () => {
  it('includes base identity, approvals, browser guardrails, and research discipline', async () => {
    const ctx = await buildContext(userId, sessionId, 'research internships');
    expect(ctx).toContain('personal AI assistant');
    expect(ctx).toContain('Auto-approved');
    expect(ctx).toContain('stop retrying');
    expect(ctx).toContain('Research discipline');
  });

  it('includes session summary when present', async () => {
    getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run('Earlier we discussed auth', sessionId);
    const ctx = await buildContext(userId, sessionId, 'continue');
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

    const ctx = await buildContext(userId, sessionId, 'continue');
    expect(ctx).toContain('Structured session state');
    expect(ctx).toContain('Organize internship applications');
    expect(ctx).toContain('index.md');

    getDb().prepare('UPDATE sessions SET session_state = NULL WHERE id = ?').run(sessionId);
  });

  it('includes project context for a pinned project', async () => {
    const projectId = makeProject('sandbox-demo', 'A sandbox project');
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = await buildContext(userId, sessionId, 'work in project');
    expect(ctx).toContain('sandbox-demo');
    expect(ctx).toContain(projectId);
    expect(ctx).toContain('project/files');
    expect(ctx).toContain('project/repo');

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
  });

  it('defers pinned project CLAUDE.md and AGENTS.md to Claude Code native loading', async () => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-instructions-'));
    fs.writeFileSync(path.join(repoPath, 'CLAUDE.md'), 'Claude project instruction: always use app MCP tools.');
    fs.writeFileSync(path.join(repoPath, 'AGENTS.md'), 'Agents project instruction: keep context compact.');

    const projectId = makeProject('instruction-project');
    getDb().prepare('UPDATE projects SET repo_path = ? WHERE id = ?').run(repoPath, projectId);
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

    const ctx = await buildContext(userId, sessionId, 'use project instructions');
    expect(ctx).toContain('Agent instruction files');
    expect(ctx).toContain('loaded natively by Claude Code');
    expect(ctx).not.toContain('Claude project instruction');
    expect(ctx).not.toContain('Agents project instruction');

    getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
    fs.rmSync(repoPath, { recursive: true, force: true });
  });
});
