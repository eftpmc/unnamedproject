import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { createProject, listProjectsForUser, getProjectForUser, linkProject } from './projects.js';
import { getDb, initDb } from '../db/index.js';
import fs from 'fs';
import { APP_ROOT } from '../lib/workspacePaths.js';

let userId: string;

beforeEach(async () => {
  process.env.DATA_DIR = `/tmp/projects-service-test-${Date.now()}-${Math.random()}`;
  process.env.UNNAMED_WORKSPACE_ROOT = `/tmp/projects-service-workspaces-${Date.now()}-${Math.random()}`;
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();

  userId = 'test-user-id';

  getDb()
    .prepare("INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)")
    .run(userId, 'test@test.com', 'hashed');
});

describe('listProjectsForUser', () => {
  it('creates project repos under the external workspace root', async () => {
    const project = await createProject({ user_id: userId, name: 'Created Project' });
    expect(project.repo_path).toContain(process.env.UNNAMED_WORKSPACE_ROOT!);
    expect(project.repo_path).not.toContain(process.env.DATA_DIR!);
    expect(fs.existsSync(path.join(project.repo_path, '.git'))).toBe(true);
  });

  it('returns only projects owned by the user', () => {
    linkProject({
      user_id: userId,
      name: 'User Project',
      repo_path: '/tmp/test-repo'
    });

    const results = listProjectsForUser(userId);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty array when user has no projects', () => {
    const results = listProjectsForUser('nonexistent-user-id');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });
});

describe('workspace boundary', () => {
  it('rejects linked repos inside the app repository', () => {
    expect(() => linkProject({
      user_id: userId,
      name: 'Harness',
      repo_path: APP_ROOT,
    })).toThrow(/outside the Unnamed app repository/);
  });
});

describe('getProjectForUser', () => {
  it('returns undefined for a project owned by a different user', () => {
    const result = getProjectForUser('nonexistent-id', 'wrong-user');
    expect(result).toBeUndefined();
  });

  it('returns a project when it belongs to the user', () => {
    const project = linkProject({
      user_id: userId,
      name: 'User Project',
      repo_path: '/tmp/test-repo'
    });

    const result = getProjectForUser(project.id, userId);
    expect(result).toBeDefined();
    expect(result?.id).toBe(project.id);
  });
});
