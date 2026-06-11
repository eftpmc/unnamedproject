import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import { initDb, getDb } from '../../src/db/index.js';
import { ensureWorktree } from '../../src/lib/worktree.js';
import { newId } from '../../src/lib/ids.js';
import type { DbProject } from '../../src/db/index.js';

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `${userId}@test.com`, 'x');
});

function makeProject(repoPath: string): DbProject {
  const id = newId();
  getDb()
    .prepare('INSERT INTO projects (id, user_id, name, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?)')
    .run(id, userId, `proj-${id}`, repoPath, '[]');
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE id = ?')
    .get(id) as DbProject;
}

function makeSession(): string {
  const id = newId();
  getDb()
    .prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)')
    .run(id, userId);
  return id;
}

describe('ensureWorktree', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
    await simpleGit().cwd(repoPath).init();
  });

  it('creates a per-session agent worktree for a repo with no commits', async () => {
    const project = makeProject(repoPath);
    const sessionId = makeSession();
    const wt = await ensureWorktree(project, sessionId);

    expect(fs.existsSync(wt.worktree_path)).toBe(true);
    expect(wt.branch).toBe(`agent/${sessionId}`);
    const branch = await simpleGit(wt.worktree_path).revparse(['--abbrev-ref', 'HEAD']);
    expect(branch.trim()).toBe(wt.branch);

    const stored = getDb().prepare('SELECT worktree_path FROM agent_worktrees WHERE id = ?').get(wt.id) as { worktree_path: string };
    expect(stored.worktree_path).toBe(wt.worktree_path);
  });

  it('reuses an existing worktree path on subsequent calls for the same session', async () => {
    const project = makeProject(repoPath);
    const sessionId = makeSession();
    const first = await ensureWorktree(project, sessionId);
    const second = await ensureWorktree(project, sessionId);
    expect(second.worktree_path).toBe(first.worktree_path);
    expect(second.id).toBe(first.id);
  });

  it('gives different sessions on the same project separate worktrees and branches', async () => {
    const project = makeProject(repoPath);
    const a = await ensureWorktree(project, makeSession());
    const b = await ensureWorktree(project, makeSession());
    expect(a.worktree_path).not.toBe(b.worktree_path);
    expect(a.branch).not.toBe(b.branch);
  });

  it('reattaches the session branch if the worktree directory was removed', async () => {
    const project = makeProject(repoPath);
    const sessionId = makeSession();
    const first = await ensureWorktree(project, sessionId);
    fs.rmSync(first.worktree_path, { recursive: true, force: true });

    const second = await ensureWorktree(project, sessionId);
    expect(fs.existsSync(second.worktree_path)).toBe(true);
    const branch = await simpleGit(second.worktree_path).revparse(['--abbrev-ref', 'HEAD']);
    expect(branch.trim()).toBe(first.branch);
  });
});
