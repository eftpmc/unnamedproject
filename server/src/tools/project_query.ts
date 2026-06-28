import { getSpaceForUser } from '../db/index.js';
import { getProject } from '../services/projects.js';
import { hasGraph, buildGraph, queryGraph } from '../services/graphify.js';

interface ProjectQueryInput {
  space_id: string;
  project_id: string;
  question: string;
}

export async function runProjectQuery(input: ProjectQueryInput, userId: string): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return 'Space not found.';
  const project = getProject(input.project_id);
  if (!project || project.space_id !== space.id) return 'Project not found in this Space.';

  const repoPath = project.repo_path;
  if (!await hasGraph(repoPath)) {
    await buildGraph(repoPath, project.id);
  }

  return await queryGraph(input.question, repoPath);
}
