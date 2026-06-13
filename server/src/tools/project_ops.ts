import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import { getDb, getProjectForUser, getProjectsRoot } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requestApproval } from '../services/executor.js';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'project';
}

export async function createProject(
  input: { name: string; description?: string; with_repo: boolean },
  userId: string,
  _executionId: string
): Promise<string> {
  let repoPath: string | null = null;

  if (input.with_repo) {
    const root = getProjectsRoot(userId);
    repoPath = path.join(root, slugify(input.name));
    try {
      await fs.access(repoPath);
      return `Error: directory already exists at ${repoPath}`;
    } catch {
      // does not exist, proceed
    }
    await fs.mkdir(repoPath, { recursive: true });
    await simpleGit().cwd(repoPath).init();
  }

  const id = newId();
  getDb()
    .prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
    .run(id, userId, input.name, input.description ?? null, repoPath, '[]');

  return `Created project '${input.name}' (id: ${id})${repoPath ? ` with repo at ${repoPath}` : ' with no repo'}`;
}

export async function updateProject(
  input: { project_id: string; name?: string; description?: string; repo_path?: string | null },
  userId: string
): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);
  if (!project) return `Error: project ${input.project_id} not found`;

  const updates: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { updates.push('name = ?'); values.push(input.name); }
  if (input.description !== undefined) { updates.push('description = ?'); values.push(input.description); }
  if (input.repo_path !== undefined) { updates.push('repo_path = ?'); values.push(input.repo_path); }

  if (updates.length > 0) {
    getDb()
      .prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...values, input.project_id, userId);
  }

  return `Project '${input.name ?? project.name}' updated`;
}

export async function deleteProject(
  input: { project_id: string; delete_files: boolean },
  userId: string,
  executionId: string
): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);
  if (!project) return `Error: project ${input.project_id} not found`;

  const decision = await requestApproval(
    executionId,
    userId,
    'delete_project',
    { project_id: input.project_id, name: project.name, repo_path: project.repo_path, delete_files: input.delete_files },
    'user'
  );
  if (decision === 'rejected') return 'delete_project cancelled';

  getDb()
    .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
    .run(input.project_id, userId);

  if (input.delete_files && project.repo_path) {
    await fs.rm(project.repo_path, { recursive: true, force: true });
  }

  return `Project '${project.name}' deleted${input.delete_files && project.repo_path ? ' (files removed)' : ''}`;
}
