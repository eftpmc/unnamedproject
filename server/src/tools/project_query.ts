import { getSpaceForUser } from '../db/index.js';
import { getItemById } from '../services/items.js';
import { hasGraph, buildGraph, queryGraph } from '../services/graphify.js';

interface ProjectQueryInput {
  space_id: string;
  item_id: string;
  question: string;
}

export async function runProjectQuery(input: ProjectQueryInput, userId: string, apiKey?: string | null): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return 'Space not found.';
  const repoItem = getItemById(input.item_id);
  if (!repoItem || repoItem.space_id !== space.id) return 'Repo item not found in this Space.';
  if (repoItem.type !== 'repo') return 'Selected item is not a repo.';

  const repoPath = repoItem.fields.repo_path as string;
  if (!await hasGraph(repoPath)) {
    await buildGraph(repoPath, input.item_id, apiKey);
  }

  return await queryGraph(input.question, repoPath, apiKey);
}
