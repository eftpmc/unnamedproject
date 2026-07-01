import fs from 'fs/promises';
import { getDb, getProjectByIdForUser } from '../db/index.js';
import { requestApproval } from '../services/executor.js';

export async function deleteProject(
  input: { project_id: string; delete_files: boolean },
  userId: string,
  executionId: string
): Promise<string> {
  const project = getProjectByIdForUser(input.project_id, userId);
  if (!project) return `Error: project ${input.project_id} not found`;

  const repoPaths = project.repo_path ? [project.repo_path] : [];

  const decision = await requestApproval(
    executionId,
    userId,
    'delete_project',
    { project_id: input.project_id, name: project.name, repo_paths: repoPaths, delete_files: input.delete_files },
    'user'
  );
  if (decision.decision === 'rejected') return 'delete_project cancelled';

  getDb().prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(input.project_id, userId);

  if (input.delete_files) {
    const toDelete = [...repoPaths];
    if (project.files_path) toDelete.push(project.files_path);
    await Promise.all(toDelete.map(p => fs.rm(p, { recursive: true, force: true })));
  }

  return `Project '${project.name}' deleted${input.delete_files && repoPaths.length > 0 ? ' (files removed)' : ''}`;
}
