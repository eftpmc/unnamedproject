import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import { getDb, getSpaceForUser, getSpacesForUser, getProjectsRoot } from '../db/index.js';
import { getItemsForSpace, createRepoItem, type SpaceItem } from '../services/items.js';
import { newId } from '../lib/ids.js';
import { requestApproval } from '../services/executor.js';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'project';
}

export async function listProjects(userId: string): Promise<string> {
  const spaces = getSpacesForUser(userId).map(s => ({ id: s.id, name: s.name, description: s.description }));
  return JSON.stringify(spaces);
}

export async function createProject(
  input: { name: string; description?: string; with_repo: boolean },
  userId: string,
  _executionId: string
): Promise<string> {
  const id = newId();
  getDb()
    .prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
    .run(id, userId, input.name, input.description ?? null, '[]');

  if (input.with_repo) {
    const root = getProjectsRoot(userId);
    const repoPath = path.join(root, slugify(input.name));
    try {
      await fs.access(repoPath);
      getDb().prepare('DELETE FROM spaces WHERE id = ?').run(id);
      return `Error: directory already exists at ${repoPath}`;
    } catch {
      // does not exist, proceed
    }
    await fs.mkdir(repoPath, { recursive: true });
    await simpleGit().cwd(repoPath).init();
    createRepoItem({ space_id: id, name: input.name, repo_path: repoPath });
    return `Created space '${input.name}' (id: ${id}) with repo at ${repoPath}`;
  }

  return `Created space '${input.name}' (id: ${id}) with no repo`;
}

export async function updateProject(
  input: { space_id: string; name?: string; description?: string },
  userId: string
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const updates: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { updates.push('name = ?'); values.push(input.name); }
  if (input.description !== undefined) { updates.push('description = ?'); values.push(input.description); }

  if (updates.length > 0) {
    getDb()
      .prepare(`UPDATE spaces SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...values, input.space_id, userId);
  }

  return `Space '${input.name ?? space.name}' updated`;
}

export async function deleteProject(
  input: { space_id: string; delete_files: boolean },
  userId: string,
  executionId: string
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const repoPaths = getItemsForSpace(space.id)
    .filter((item): item is SpaceItem & { type: 'repo' } => item.type === 'repo')
    .map(item => item.repo_path);

  const decision = await requestApproval(
    executionId,
    userId,
    'delete_space',
    { space_id: input.space_id, name: space.name, repo_paths: repoPaths, delete_files: input.delete_files },
    'user'
  );
  if (decision === 'rejected') return 'delete_space cancelled';

  getDb()
    .prepare('DELETE FROM spaces WHERE id = ? AND user_id = ?')
    .run(input.space_id, userId);

  if (input.delete_files) {
    await Promise.all(repoPaths.map(repoPath => fs.rm(repoPath, { recursive: true, force: true })));
  }

  return `Space '${space.name}' deleted${input.delete_files && repoPaths.length > 0 ? ' (files removed)' : ''}`;
}
