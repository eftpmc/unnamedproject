import { queryGraph } from '../services/graphify.js';
import { getProjectForUser } from '../db/index.js';

interface ProjectQueryInput {
  project_id: string;
  question: string;
}

export async function runProjectQuery(input: ProjectQueryInput, userId: string): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);

  if (!project?.repo_path) {
    return 'Project has no repo path configured.';
  }

  return await queryGraph(project.repo_path, input.question);
}
