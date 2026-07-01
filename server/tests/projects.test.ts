import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb } from '../src/db/index.js';
import { createProject, linkProject, listProjectsForUser, getProject, deleteProject } from '../src/services/projects.js';
import { APP_ROOT } from '../src/lib/workspacePaths.js';

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u2','proj@test','x')").run();
});

describe('projects service', () => {
  it('creates a repo on disk and indexes it', async () => {
    const proj = await createProject({ user_id: 'u2', name: 'Yuzic' });
    expect(proj.origin).toBe('created');
    expect(proj.repo_path).toContain(process.env.UNNAMED_WORKSPACE_ROOT!);
    expect(proj.repo_path).not.toContain(process.env.DATA_DIR!);
    expect(fs.existsSync(path.join(proj.repo_path, '.git'))).toBe(true);
    expect(listProjectsForUser('u2').map(p => p.id)).toContain(proj.id);
  });

  it('links an external repo path', () => {
    const proj = linkProject({ user_id: 'u2', name: 'External', repo_path: '/tmp/some/repo', default_branch: 'main' });
    expect(proj.origin).toBe('linked');
    expect(getProject(proj.id)?.repo_path).toBe('/tmp/some/repo');
  });

  it('rejects project repos inside the app repository', () => {
    expect(() => linkProject({ user_id: 'u2', name: 'Harness', repo_path: APP_ROOT })).toThrow(/outside the Unnamed app repository/);
  });

  it('deletes the index row', () => {
    const proj = linkProject({ user_id: 'u2', name: 'Gone', repo_path: '/tmp/gone' });
    expect(deleteProject(proj.id)).toBe(true);
    expect(getProject(proj.id)).toBeUndefined();
  });
});
