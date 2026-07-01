import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { registerProjectHandlers } from '../src/mcp/handlers/projects.js';
import { getTool } from '../src/mcp/registry.js';
import { newId } from '../src/lib/ids.js';

let projectId: string;
const userId = 'u-projtools';

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  projectId = newId();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES (?,?,?)").run(userId, 'pt@test.com', 'x');
  getDb().prepare("INSERT INTO projects (id,user_id,name,repo_path,default_branch,origin,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(projectId, userId, 'ProjToolsProj', '/tmp/projtools', null, 'linked', Math.floor(Date.now() / 1000));
  registerProjectHandlers();
});

describe('project tools', () => {
  it('link_project then list_git_repos', async () => {
    const repoPath = fs.mkdtempSync('/tmp/pt-repo-');
    const linked = JSON.parse(await getTool('link_project')!.handler(
      { project_id: projectId, name: 'Repo', repo_path: repoPath }, userId, null));
    expect(linked.origin).toBe('linked');
    expect(linked.repo_path).toBe(repoPath);

    const list = JSON.parse(await getTool('list_git_repos')!.handler({ project_id: linked.id }, userId, null));
    expect(list.map((p: { id: string }) => p.id)).toContain(linked.id);
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('returns error for unknown project', async () => {
    const result = await getTool('list_git_repos')!.handler({ project_id: 'nonexistent' }, userId, null);
    expect(result).toContain('Error');
  });
});
