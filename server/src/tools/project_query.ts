import { getProjectByIdForUser } from '../db/index.js';
import { getProject } from '../services/projects.js';
import { hasGraph, buildGraph, queryGraph } from '../services/graphify.js';

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
  if (!await hasGraph(repoPath)) {
    await buildGraph(repoPath, project.id);
  }

  return await queryGraph(input.question, repoPath);
}
