import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb } from '../src/db/index.js';
import { createProject, linkProject, listProjects, getProject, deleteProject } from '../src/services/projects.js';

const SPACE = 'space-proj';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u2','proj@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u2', 'Proj');
});

describe('projects service', () => {
  it('creates a repo on disk and indexes it', async () => {
    const proj = await createProject({ space_id: SPACE, name: 'Yuzic' });
    expect(proj.origin).toBe('created');
    expect(fs.existsSync(path.join(proj.repo_path, '.git'))).toBe(true);
    expect(listProjects(SPACE).map(p => p.id)).toContain(proj.id);
  });

  it('links an external repo path', () => {
    const proj = linkProject({ space_id: SPACE, name: 'External', repo_path: '/tmp/some/repo', default_branch: 'main' });
    expect(proj.origin).toBe('linked');
    expect(getProject(proj.id)?.repo_path).toBe('/tmp/some/repo');
  });

  it('deletes the index row', () => {
    const proj = linkProject({ space_id: SPACE, name: 'Gone', repo_path: '/tmp/gone' });
    expect(deleteProject(proj.id)).toBe(true);
    expect(getProject(proj.id)).toBeUndefined();
  });
});
