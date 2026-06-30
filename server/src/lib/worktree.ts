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
interface WorktreeRepoItem {
  id: string;
  fields: { repo_path: string };
}

/**
 * Returns an isolated git worktree for a (repo item, session) pair, on its own
 * branch off the repo's default branch, creating it on first use.
 * Coding tools operate here so concurrent sessions on the same repo never
 * collide, and the repo's main checkout stays untouched until the
 * session's branch is reviewed and pushed/merged.
 */
export async function ensureWorktree(repoItem: WorktreeRepoItem, sessionId: string): Promise<DbAgentWorktree> {
  const repoPath = repoItem.fields.repo_path as string;
  const existing = getAgentWorktree(repoItem.id, sessionId);
  if (existing) {
    try {
      await fs.access(existing.worktree_path);
      return existing;
    } catch {
      // worktree directory was removed externally; recreate below
    }
  }

  const git = simpleGit(repoPath);
  await ensureInitialCommit(git, repoPath);

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

async function ensureInitialCommit(git: ReturnType<typeof simpleGit>, repoPath: string): Promise<void> {
  // Check whether this directory owns its own .git, not just inherits one from
  // a parent. If the project dir sits inside another git repo (e.g. the app's
  // own working tree), git rev-parse HEAD would succeed against the outer repo
  // and git_op would silently operate on the wrong codebase.
  const gitEntry = path.join(repoPath, '.git');
  let hasOwnGit = false;
  try {
    await fs.access(gitEntry);
    hasOwnGit = true;
  } catch { /* no .git here */ }

  if (!hasOwnGit) {
    await git.init();
    await git.raw(['commit', '--allow-empty', '-m', 'Initial commit']);
    return;
  }

  try {
    await git.raw(['rev-parse', 'HEAD']);
  } catch {
    await git.raw(['commit', '--allow-empty', '-m', 'Initial commit']);
  }
}
