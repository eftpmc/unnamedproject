import { getProjectForUser } from '../db/index.js';
import { hasGraph, buildGraph, queryGraph } from '../services/graphify.js';

interface ProjectQueryInput {
  project_id: string;
  question: string;
}

export async function runProjectQuery(input: ProjectQueryInput, userId: string, apiKey?: string | null): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);
  if (!project) return 'Project not found.';
  if (!project.repo_path) return 'Project has no repo path configured.';

  const repoPath = project.repo_path;
  if (!await hasGraph(repoPath)) {
    await buildGraph(repoPath, input.project_id, apiKey);
  }

  return await queryGraph(input.question, repoPath, apiKey);
}
