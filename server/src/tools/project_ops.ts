import fs from 'fs/promises';
import { getDb, getProjectByIdForUser } from '../db/index.js';
import { listProjects } from '../services/projects.js';
import { requestApproval } from '../services/executor.js';

export async function deleteProject(
  input: { project_id: string; delete_files: boolean },
  userId: string,
  executionId: string
): Promise<string> {
  const project = getProjectByIdForUser(input.project_id, userId);
  if (!project) return `Error: project ${input.project_id} not found`;

  const repoPaths = listProjects(project.space_id).map(p => p.repo_path).filter(Boolean);

  const decision = await requestApproval(
    executionId,
    userId,
    'delete_project',
    { project_id: input.project_id, name: project.name, repo_paths: repoPaths, delete_files: input.delete_files },
    'user'
  );
  if (decision === 'rejected') return 'delete_project cancelled';

  getDb().prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(input.project_id, userId);
  getDb().prepare('DELETE FROM spaces WHERE id = ?').run(project.space_id);

  if (input.delete_files) {
    await Promise.all(repoPaths.map(repoPath => fs.rm(repoPath, { recursive: true, force: true })));
  }

  return `Project '${project.name}' deleted${input.delete_files && repoPaths.length > 0 ? ' (files removed)' : ''}`;
}
