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
    if (!root) {
      return 'Error: projects_root is not set. Ask the user to set a Projects root in Settings before creating repo-backed projects.';
    }
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
  input: { project_id: string; description?: string },
  userId: string
): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);
  if (!project) return `Error: project ${input.project_id} not found`;

  if (input.description !== undefined) {
    getDb()
      .prepare('UPDATE projects SET description = ? WHERE id = ? AND user_id = ?')
      .run(input.description, input.project_id, userId);
  }

  return `Project '${project.name}' updated`;
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
