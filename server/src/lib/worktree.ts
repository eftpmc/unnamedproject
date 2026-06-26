import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import {
  getDataDir,
  getAgentWorktree,
  createAgentWorktree,
  updateAgentWorktreePath,
  type DbAgentWorktree,
} from '../db/index.js';
import type { RepoItem } from '../services/items.js';

/**
 * Returns an isolated git worktree for a (repo item, session) pair, on its own
 * branch off the repo's default branch, creating it on first use.
 * Coding tools operate here so concurrent sessions on the same repo never
 * collide, and the repo's main checkout stays untouched until the
 * session's branch is reviewed and pushed/merged.
 */
export async function ensureWorktree(repoItem: RepoItem, sessionId: string): Promise<DbAgentWorktree> {
  const existing = getAgentWorktree(repoItem.id, sessionId);
  if (existing) {
    try {
      await fs.access(existing.worktree_path);
      return existing;
    } catch {
      // worktree directory was removed externally; recreate below
    }
  }

  const git = simpleGit(repoItem.repo_path);
  await ensureInitialCommit(git);

  const branch = existing?.branch ?? `agent/${sessionId}`;
  // Must be absolute: simple-git runs with cwd=repoItem.repo_path, so a relative
  // path here would be resolved by git against the repo dir while fs.* below
  // resolve it against the server's cwd, putting the worktree in two places.
  const worktreePath = existing?.worktree_path ?? path.resolve(getDataDir(), 'worktrees', repoItem.id, sessionId);
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
  return createAgentWorktree(repoItem.id, sessionId, branch, worktreePath);
}

async function ensureInitialCommit(git: ReturnType<typeof simpleGit>): Promise<void> {
  try {
    await git.raw(['rev-parse', 'HEAD']);
  } catch {
    await git.raw(['commit', '--allow-empty', '-m', 'Initial commit']);
  }
}
