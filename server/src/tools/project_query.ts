import { getProjectByIdForUser } from '../db/index.js';
import { getProject } from '../services/projects.js';
import { hasIndex, buildIndex, queryIndex } from '../services/repoIndex.js';

interface ProjectQueryInput {
  project_id: string;
  question: string;
}

export async function runProjectQuery(input: ProjectQueryInput, userId: string): Promise<string> {
  const project = userId
    ? getProjectByIdForUser(input.project_id, userId)
    : getProject(input.project_id);
  if (!project) return 'Project not found.';

  const repoPath = project.repo_path;
  if (!await hasIndex(repoPath)) {
    await buildIndex(repoPath, project.id);
  }

  return await queryIndex(input.question, repoPath);
}
