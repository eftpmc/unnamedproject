import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createProject, updateProject, deleteProject } from '../../src/tools/project_ops.js';

const dbState = {
  projects: new Map<string, { id: string; user_id: string; name: string; description: string | null; repo_path: string | null; type: string }>(),
  projectsRoot: null as string | null,
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.startsWith('INSERT INTO projects')) {
          const [id, user_id, name, description, repo_path, , type] = args as string[];
          dbState.projects.set(id, { id, user_id, name, description, repo_path, type });
        } else if (sql.startsWith('UPDATE projects SET description')) {
          const [description, id, user_id] = args as string[];
          const p = dbState.projects.get(id);
          if (p && p.user_id === user_id) p.description = description;
        } else if (sql.startsWith('UPDATE projects SET type')) {
          const [type, id, user_id] = args as string[];
          const p = dbState.projects.get(id);
          if (p && p.user_id === user_id) p.type = type;
        } else if (sql.startsWith('DELETE FROM projects')) {
          const [id, user_id] = args as string[];
          const p = dbState.projects.get(id);
          if (p && p.user_id === user_id) dbState.projects.delete(id);
        }
        return { changes: 1 };
      },
      get: (...args: unknown[]) => {
        if (sql.startsWith('SELECT projects_root')) return { projects_root: dbState.projectsRoot };
        const [id, user_id] = args as string[];
        const p = dbState.projects.get(id);
        return p && p.user_id === user_id ? p : undefined;
      },
    }),
  }),
  getProjectForUser: (id: string, userId: string) => {
    const p = dbState.projects.get(id);
    return p && p.user_id === userId ? { ...p, enabled_connection_ids: '[]' } : undefined;
  },
  getProjectsRoot: (_userId: string) => dbState.projectsRoot,
}));

vi.mock('../../src/lib/ids.js', () => ({ newId: () => 'new-id' }));

vi.mock('../../src/services/executor.js', () => ({
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));

const userId = 'u1';
let tmpRoot: string;

beforeEach(() => {
  dbState.projects.clear();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-root-'));
  dbState.projectsRoot = tmpRoot;
});

describe('create_project', () => {
  it('creates a project without a repo', async () => {
    const result = await createProject({ name: 'Notes', with_repo: false }, userId, 'exec-1');
    expect(result).toContain('new-id');
    expect(dbState.projects.get('new-id')?.repo_path).toBeNull();
  });

  it('creates a project with a repo under projects_root', async () => {
    const result = await createProject({ name: 'My App', description: 'desc', with_repo: true }, userId, 'exec-1');
    expect(result).toContain('new-id');
    const repoPath = dbState.projects.get('new-id')?.repo_path;
    expect(repoPath).toBe(path.join(tmpRoot, 'my-app'));
    expect(fs.existsSync(path.join(repoPath!, '.git'))).toBe(true);
  });

  it('defaults to type "default" when not specified', async () => {
    await createProject({ name: 'Notes', with_repo: false }, userId, 'exec-1');
    expect(dbState.projects.get('new-id')?.type).toBe('default');
  });

  it('persists a valid type when specified', async () => {
    await createProject({ name: 'Vid', with_repo: false, type: 'video' }, userId, 'exec-1');
    expect(dbState.projects.get('new-id')?.type).toBe('video');
  });

  it('rejects an invalid type without inserting a row', async () => {
    const result = await createProject({ name: 'Bad', with_repo: false, type: 'bogus' }, userId, 'exec-1');
    expect(result).toMatch(/^Error:/);
    expect(dbState.projects.has('new-id')).toBe(false);
  });
});

describe('update_project', () => {
  it('updates the description', async () => {
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: 'old', repo_path: null, type: 'default' });
    const result = await updateProject({ project_id: 'p1', description: 'new desc' }, userId);
    expect(result).toContain('updated');
    expect(dbState.projects.get('p1')?.description).toBe('new desc');
  });

  it('updates the type when valid', async () => {
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: 'old', repo_path: null, type: 'default' });
    const result = await updateProject({ project_id: 'p1', type: 'video' }, userId);
    expect(result).toContain('updated');
    expect(dbState.projects.get('p1')?.type).toBe('video');
  });

  it('rejects an invalid type without mutating the row', async () => {
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: 'old', repo_path: null, type: 'default' });
    const result = await updateProject({ project_id: 'p1', type: 'bogus' }, userId);
    expect(result).toMatch(/^Error:/);
    expect(dbState.projects.get('p1')?.type).toBe('default');
  });
});

describe('delete_project', () => {
  it('removes the project record without deleting files when delete_files is false', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-repo-'));
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null, repo_path: repoDir, type: 'default' });

    const result = await deleteProject({ project_id: 'p1', delete_files: false }, userId, 'exec-1');

    expect(result).toContain('deleted');
    expect(dbState.projects.has('p1')).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(true);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('removes the project record and deletes files when delete_files is true', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-repo-'));
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null, repo_path: repoDir, type: 'default' });

    const result = await deleteProject({ project_id: 'p1', delete_files: true }, userId, 'exec-1');

    expect(result).toContain('deleted');
    expect(dbState.projects.has('p1')).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(false);
  });

  it('returns a cancellation message when the user rejects', async () => {
    const { requestApproval } = await import('../../src/services/executor.js');
    vi.mocked(requestApproval).mockResolvedValueOnce('rejected');
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null, repo_path: null, type: 'default' });

    const result = await deleteProject({ project_id: 'p1', delete_files: false }, userId, 'exec-1');

    expect(result).toContain('cancelled');
    expect(dbState.projects.has('p1')).toBe(true);
  });
});
