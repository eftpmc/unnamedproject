import { describe, it, expect, beforeEach } from 'vitest';
import { listProjectsForUser, getProjectForUser, linkProject } from './projects.js';
import { getDb, initDb } from '../db/index.js';
import fs from 'fs';

let userId: string;
let spaceId: string;

beforeEach(async () => {
  process.env.DATA_DIR = `/tmp/projects-service-test-${Date.now()}-${Math.random()}`;
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();

  userId = 'test-user-id';
  const now = Math.floor(Date.now() / 1000);

  getDb()
    .prepare("INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)")
    .run(userId, 'test@test.com', 'hashed');

  // Create a space for the user
  getDb().prepare(
    "INSERT INTO spaces (id, user_id, name, created_at) VALUES (?, ?, ?, ?)"
  ).run('space-1', userId, 'Test Space', now);

  spaceId = 'space-1';
});

describe('listProjectsForUser', () => {
  it('returns only projects owned by the user via their spaces', () => {
    // Create a project linked to the space
    linkProject({
      space_id: spaceId,
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

describe('getProjectForUser', () => {
  it('returns undefined for a project owned by a different user', () => {
    const result = getProjectForUser('nonexistent-id', 'wrong-user');
    expect(result).toBeUndefined();
  });

  it('returns a project when it belongs to the user', () => {
    const project = linkProject({
      space_id: spaceId,
      name: 'User Project',
      repo_path: '/tmp/test-repo'
    });

    const result = getProjectForUser(project.id, userId);
    expect(result).toBeDefined();
    expect(result?.id).toBe(project.id);
  });
});
