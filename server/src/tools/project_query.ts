import { getProjectForUser } from '../db/index.js';
import { hasGraph, buildGraph, queryGraph } from '../services/graphify.js';

interface ProjectQueryInput {
  project_id: string;
  question: string;
}

export async function runProjectQuery(input: ProjectQueryInput, userId: string): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);
  if (!project) return 'Project not found.';
  if (!project.repo_path) return 'Project has no repo path configured.';

  if (!await hasGraph(input.project_id)) {
    await buildGraph(project.repo_path, input.project_id);
  }

  return await queryGraph(input.question, input.project_id);
}
