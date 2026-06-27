import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listProjects, createProject, updateProject, deleteProject } from '../../src/tools/project_ops.js';

let idSeq = 0;

const dbState = {
  spaces: new Map<string, { id: string; user_id: string; name: string; description: string | null }>(),
  projects: new Map<string, { id: string; space_id: string; name: string; repo_path: string }>(),
  projectsRoot: null as string | null,
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO spaces')) {
          const [id, user_id, name, description] = args as string[];
          dbState.spaces.set(id, { id, user_id, name, description });
        } else if (sql.includes('DELETE FROM spaces')) {
          const [id, user_id] = args as string[];
          const s = dbState.spaces.get(id);
          if (s && s.user_id === user_id) dbState.spaces.delete(id);
        } else if (sql.includes('UPDATE spaces SET')) {
          // dynamic UPDATE: extract columns from SET clause
          const setMatch = sql.match(/SET (.+) WHERE/)?.[1] ?? '';
          const cols = setMatch.split(',').map(c => c.trim().replace(/\s*=.*/, ''));
          const idIdx = args.length - 2;
          const userIdIdx = args.length - 1;
          const spaceId = args[idIdx] as string;
          const userId = args[userIdIdx] as string;
          const s = dbState.spaces.get(spaceId);
          if (s && s.user_id === userId) {
            cols.forEach((col, i) => {
              if (col === 'name') s.name = args[i] as string;
              if (col === 'description') s.description = args[i] as string;
            });
          }
        } else if (sql.includes('INSERT INTO projects')) {
          const [id, space_id, name, repo_path] = args as string[];
          dbState.projects.set(id, { id, space_id, name, repo_path });
        }
        return { changes: 1 };
      },
      get: () => undefined,
    }),
    transaction: (fn: () => unknown) => () => fn(),
  }),
  getSpaceForUser: (id: string, userId: string) => {
    const s = dbState.spaces.get(id);
    return s && s.user_id === userId ? { ...s, enabled_connection_ids: '[]' } : undefined;
  },
  getSpacesForUser: (userId: string) => [...dbState.spaces.values()].filter(s => s.user_id === userId),
  getProjectsRoot: (_userId: string) => dbState.projectsRoot,
}));

vi.mock('../../src/services/projects.js', () => ({
  listProjects: (spaceId: string) => {
    return [...dbState.projects.values()].filter(p => p.space_id === spaceId);
  },
}));

vi.mock('../../src/lib/ids.js', () => ({
  newId: () => `id-${++idSeq}`,
}));

vi.mock('../../src/services/executor.js', () => ({
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));

const userId = 'u1';
let tmpRoot: string;

beforeEach(() => {
  idSeq = 0;
  dbState.spaces.clear();
  dbState.projects.clear();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-root-'));
  dbState.projectsRoot = tmpRoot;
});

describe('list_spaces', () => {
  it('returns an empty array when the user has no Spaces', async () => {
    const result = await listProjects(userId);
    expect(JSON.parse(result)).toEqual([]);
  });

  it("returns only the requesting user's Spaces with id, name, description", async () => {
    dbState.spaces.set('p1', { id: 'p1', user_id: userId, name: 'api', description: 'desc' });
    dbState.spaces.set('p2', { id: 'p2', user_id: 'other-user', name: 'not mine', description: null });

    const result = await listProjects(userId);
    expect(JSON.parse(result)).toEqual([{ id: 'p1', name: 'api', description: 'desc' }]);
  });
});

describe('create_space', () => {
  it('creates a space without a repo', async () => {
    const result = await createProject({ name: 'Notes', with_repo: false }, userId, 'exec-1');
    expect(result).toContain('id-1');
    expect(dbState.spaces.size).toBe(1);
    expect(dbState.projects.size).toBe(0);
  });

  it('creates a space with a repo under projects_root', async () => {
    const result = await createProject({ name: 'My App', description: 'desc', with_repo: true }, userId, 'exec-1');
    expect(result).toContain('My App');
    const proj = [...dbState.projects.values()][0];
    expect(proj).toBeDefined();
    expect(proj.repo_path).toBe(path.join(tmpRoot, 'my-app'));
    expect(fs.existsSync(path.join(proj.repo_path, '.git'))).toBe(true);
  });

  it('creates a space without a type field', async () => {
    await createProject({ name: 'Notes', with_repo: false }, userId, 'exec-1');
    const space = dbState.spaces.get('id-1');
    expect(space).toBeDefined();
    expect((space as Record<string, unknown>).type).toBeUndefined();
  });
});

describe('update_space', () => {
  it('updates the description', async () => {
    dbState.spaces.set('p1', { id: 'p1', user_id: userId, name: 'api', description: 'old' });
    const result = await updateProject({ space_id: 'p1', description: 'new desc' }, userId);
    expect(result).toContain('updated');
  });
});

describe('delete_space', () => {
  it('removes the project record without deleting files when delete_files is false', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-repo-'));
    dbState.spaces.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null });
    dbState.projects.set('proj-p1', { id: 'proj-p1', space_id: 'p1', name: 'api', repo_path: repoDir });

    const result = await deleteProject({ space_id: 'p1', delete_files: false }, userId, 'exec-1');

    expect(result).toContain('deleted');
    expect(dbState.spaces.has('p1')).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(true);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('removes the project record and deletes files when delete_files is true', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-repo-'));
    dbState.spaces.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null });
    dbState.projects.set('proj-p1', { id: 'proj-p1', space_id: 'p1', name: 'api', repo_path: repoDir });

    const result = await deleteProject({ space_id: 'p1', delete_files: true }, userId, 'exec-1');

    expect(result).toContain('deleted');
    expect(dbState.spaces.has('p1')).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(false);
  });

  it('returns a cancellation message when the user rejects', async () => {
    const { requestApproval } = await import('../../src/services/executor.js');
    vi.mocked(requestApproval).mockResolvedValueOnce('rejected');
    dbState.spaces.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null });

    const result = await deleteProject({ space_id: 'p1', delete_files: false }, userId, 'exec-1');

    expect(result).toContain('cancelled');
    expect(dbState.spaces.has('p1')).toBe(true);
  });
});
