import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { deleteProject } from '../../src/tools/project_ops.js';

const dbState = {
  projects: new Map<string, { id: string; space_id: string; user_id: string; name: string; repo_path: string }>(),
  spaces: new Map<string, { id: string }>(),
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.includes('DELETE FROM projects')) {
          const [id, userId] = args as string[];
          const p = dbState.projects.get(id);
          if (p && p.user_id === userId) dbState.projects.delete(id);
        } else if (sql.includes('DELETE FROM spaces')) {
          const [id] = args as string[];
          dbState.spaces.delete(id);
        }
        return { changes: 1 };
      },
    }),
  }),
  getProjectByIdForUser: (id: string, userId: string) => {
    const p = dbState.projects.get(id);
    return p && p.user_id === userId ? p : undefined;
  },
}));

vi.mock('../../src/services/projects.js', () => ({
  listProjects: (spaceId: string) =>
    [...dbState.projects.values()].filter(p => p.space_id === spaceId),
}));

vi.mock('../../src/services/executor.js', () => ({
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));

const userId = 'u1';

beforeEach(() => {
  dbState.projects.clear();
  dbState.spaces.clear();
});

describe('delete_project', () => {
  it('removes the project record without deleting files when delete_files is false', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-repo-'));
    dbState.spaces.set('s1', { id: 's1' });
    dbState.projects.set('p1', { id: 'p1', space_id: 's1', user_id: userId, name: 'api', repo_path: repoDir });

    const result = await deleteProject({ project_id: 'p1', delete_files: false }, userId, 'exec-1');

    expect(result).toContain('deleted');
    expect(dbState.projects.has('p1')).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(true);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('removes the project record and deletes files when delete_files is true', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-repo-'));
    dbState.spaces.set('s1', { id: 's1' });
    dbState.projects.set('p1', { id: 'p1', space_id: 's1', user_id: userId, name: 'api', repo_path: repoDir });

    const result = await deleteProject({ project_id: 'p1', delete_files: true }, userId, 'exec-1');

    expect(result).toContain('deleted');
    expect(dbState.projects.has('p1')).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(false);
  });

  it('returns an error for a project not belonging to the user', async () => {
    dbState.projects.set('p1', { id: 'p1', space_id: 's1', user_id: 'other-user', name: 'api', repo_path: '/fake' });
    const result = await deleteProject({ project_id: 'p1', delete_files: false }, userId, 'exec-1');
    expect(result).toContain('Error');
    expect(result).toContain('p1');
  });

  it('returns a cancellation message when the user rejects', async () => {
    const { requestApproval } = await import('../../src/services/executor.js');
    vi.mocked(requestApproval).mockResolvedValueOnce('rejected');
    dbState.spaces.set('s1', { id: 's1' });
    dbState.projects.set('p1', { id: 'p1', space_id: 's1', user_id: userId, name: 'api', repo_path: '/fake' });

    const result = await deleteProject({ project_id: 'p1', delete_files: false }, userId, 'exec-1');

    expect(result).toContain('cancelled');
    expect(dbState.projects.has('p1')).toBe(true);
  });
});
