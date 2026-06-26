import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import { initDb, getDb } from '../../src/db/index.js';
import { createItem } from '../../src/services/items.js';
import { ensureWorktree } from '../../src/lib/worktree.js';

async function makeRepo(): Promise<string> {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
  await simpleGit().cwd(repoPath).init();
  return repoPath;
}

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, hashed_password) VALUES ('u1', 'a@b.com', 'h')`).run();
  db.prepare(`INSERT INTO spaces (id, user_id, name) VALUES ('sp1', 'u1', 'Space One')`).run();
  db.prepare(`INSERT INTO sessions (id, user_id) VALUES ('sess1', 'u1')`).run();
});

describe('ensureWorktree', () => {
  it('keys the worktree by (item_id, session_id), so two repo items in the same Space and session get distinct worktrees', async () => {
    const repoA = createItem({ space_id: 'sp1', name: 'repo-a', type: 'repo', page_blocks: [], fields: { repo_path: await makeRepo() } });
    const repoB = createItem({ space_id: 'sp1', name: 'repo-b', type: 'repo', page_blocks: [], fields: { repo_path: await makeRepo() } });

    const worktreeA = await ensureWorktree(repoA, 'sess1');
    const worktreeB = await ensureWorktree(repoB, 'sess1');

    expect(worktreeA.id).not.toBe(worktreeB.id);

    const row = getDb().prepare('SELECT item_id FROM agent_worktrees WHERE id = ?').get(worktreeA.id) as { item_id: string };
    expect(row.item_id).toBe(repoA.id);
  });

  it('reuses the same worktree for the same (item_id, session_id) pair', async () => {
    const repo = createItem({ space_id: 'sp1', name: 'repo-c', type: 'repo', page_blocks: [], fields: { repo_path: await makeRepo() } });
    const first = await ensureWorktree(repo, 'sess1');
    const second = await ensureWorktree(repo, 'sess1');
    expect(first.id).toBe(second.id);
  });
});
