import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import {
  getDataDir,
  getAgentWorktree,
  createAgentWorktree,
  updateAgentWorktreePath,
  type DbProject,
  type DbAgentWorktree,
} from '../db/index.js';

/**
 * Returns an isolated git worktree for a (project, session) pair, on its own
 * branch off the project's default branch, creating it on first use.
 * Coding tools operate here so concurrent sessions on the same project never
 * collide, and the project's main checkout stays untouched until the
 * session's branch is reviewed and pushed/merged.
 */
export async function ensureWorktree(project: DbProject, sessionId: string): Promise<DbAgentWorktree> {
  if (!project.repo_path) throw new Error('Project has no repo');

  const existing = getAgentWorktree(project.id, sessionId);
  if (existing) {
    try {
      await fs.access(existing.worktree_path);
      return existing;
    } catch {
      // worktree directory was removed externally; recreate below
    }
  }

  const git = simpleGit(project.repo_path);
  await ensureInitialCommit(git);

  const branch = existing?.branch ?? `agent/${sessionId}`;
  const worktreePath = existing?.worktree_path ?? path.join(getDataDir(), 'worktrees', project.id, sessionId);
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  await fs.rm(worktreePath, { recursive: true, force: true });

  // Clean up any stale worktree registration pointing at an old path.
  await git.raw(['worktree', 'prune']).catch(() => {});

  const branches = await git.branchLocal();
  if (branches.all.includes(branch)) {
    await git.raw(['worktree', 'add', worktreePath, branch]);
  } else {
    const baseBranch = (await git.status()).current ?? 'HEAD';
    await git.raw(['worktree', 'add', '-b', branch, worktreePath, baseBranch]);
  }

  if (existing) {
    updateAgentWorktreePath(existing.id, worktreePath);
    return { ...existing, worktree_path: worktreePath };
  }
  return createAgentWorktree(project.id, sessionId, branch, worktreePath);
}

async function ensureInitialCommit(git: ReturnType<typeof simpleGit>): Promise<void> {
  try {
    await git.raw(['rev-parse', 'HEAD']);
  } catch {
    await git.raw(['commit', '--allow-empty', '-m', 'Initial commit']);
  }
}
