import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listProjects, createProject, updateProject, deleteProject } from '../../src/tools/project_ops.js';

const dbState = {
  spaces: new Map<string, { id: string; user_id: string; name: string; description: string | null }>(),
  items: new Map<string, { id: string; space_id: string; type: string; name: string; repo_path: string | null }>(),
  projectsRoot: null as string | null,
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.startsWith('INSERT INTO spaces')) {
          const [id, user_id, name, description] = args as string[];
          dbState.spaces.set(id, { id, user_id, name, description });
        } else if (sql.startsWith('DELETE FROM spaces')) {
          const [id, user_id] = args as string[];
          const s = dbState.spaces.get(id);
          if (s && s.user_id === user_id) dbState.spaces.delete(id);
        } else if (sql.startsWith('UPDATE spaces SET')) {
          // description update
          const [description, id, user_id] = args as string[];
          const s = dbState.spaces.get(id);
          if (s && s.user_id === user_id) s.description = description;
        } else if (sql.startsWith('INSERT INTO space_items')) {
          const [id, space_id, type, name] = args as string[];
          dbState.items.set(id, { id, space_id, type, name, repo_path: null });
        } else if (sql.startsWith('INSERT INTO space_repos')) {
          const [item_id, repo_path] = args as string[];
          const item = dbState.items.get(item_id);
          if (item) item.repo_path = repo_path;
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

vi.mock('../../src/services/items.js', () => ({
  getItemsForSpace: (spaceId: string) => {
    return [...dbState.items.values()]
      .filter(i => i.space_id === spaceId)
      .map(i => ({ ...i, default_branch: null, created_at: 0, source_session_id: null, source_plan_id: null, source_step_id: null }));
  },
  createRepoItem: (input: { space_id: string; name: string; repo_path: string }) => {
    const id = 'item-' + input.space_id;
    const item = { id, space_id: input.space_id, type: 'repo', name: input.name, repo_path: input.repo_path };
    dbState.items.set(id, item);
    return { ...item, default_branch: null, created_at: 0, source_session_id: null, source_plan_id: null, source_step_id: null };
  },
}));

vi.mock('../../src/lib/ids.js', () => ({ newId: () => 'new-id' }));

vi.mock('../../src/services/executor.js', () => ({
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));

const userId = 'u1';
let tmpRoot: string;

beforeEach(() => {
  dbState.spaces.clear();
  dbState.items.clear();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-root-'));
  dbState.projectsRoot = tmpRoot;
});

describe('list_spaces', () => {
  it('returns an empty array when the user has no Spaces', async () => {
    const result = await listProjects(userId);
    expect(JSON.parse(result)).toEqual([]);
  });

  it('returns only the requesting user\'s Spaces with id, name, description', async () => {
    dbState.spaces.set('p1', { id: 'p1', user_id: userId, name: 'api', description: 'desc' });
    dbState.spaces.set('p2', { id: 'p2', user_id: 'other-user', name: 'not mine', description: null });

    const result = await listProjects(userId);

    expect(JSON.parse(result)).toEqual([{ id: 'p1', name: 'api', description: 'desc' }]);
  });
});

describe('create_space', () => {
  it('creates a project without a repo', async () => {
    const result = await createProject({ name: 'Notes', with_repo: false }, userId, 'exec-1');
    expect(result).toContain('new-id');
    expect(dbState.spaces.get('new-id')).toBeDefined();
    expect(dbState.items.size).toBe(0);
  });

  it('creates a project with a repo under projects_root', async () => {
    const result = await createProject({ name: 'My App', description: 'desc', with_repo: true }, userId, 'exec-1');
    expect(result).toContain('new-id');
    const repoItem = [...dbState.items.values()].find(i => i.space_id === 'new-id');
    expect(repoItem?.repo_path).toBe(path.join(tmpRoot, 'my-app'));
    expect(fs.existsSync(path.join(repoItem!.repo_path!, '.git'))).toBe(true);
  });

  it('creates a project without a type field', async () => {
    await createProject({ name: 'Notes', with_repo: false }, userId, 'exec-1');
    expect(dbState.spaces.has('new-id')).toBe(true);
    expect((dbState.spaces.get('new-id') as Record<string, unknown>).type).toBeUndefined();
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
    dbState.items.set('item-p1', { id: 'item-p1', space_id: 'p1', type: 'repo', name: 'api', repo_path: repoDir });

    const result = await deleteProject({ space_id: 'p1', delete_files: false }, userId, 'exec-1');

    expect(result).toContain('deleted');
    expect(dbState.spaces.has('p1')).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(true);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('removes the project record and deletes files when delete_files is true', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-repo-'));
    dbState.spaces.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null });
    dbState.items.set('item-p1', { id: 'item-p1', space_id: 'p1', type: 'repo', name: 'api', repo_path: repoDir });

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
