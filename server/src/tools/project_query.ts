import { getDb, getSpaceForUser } from '../db/index.js';
import { getItemById } from '../services/items.js';
import { hasGraph, buildGraph, queryGraph } from '../services/graphify.js';
import { getDecryptedConfig } from '../routes/connections.js';

interface ProjectQueryInput {
  space_id: string;
  item_id: string;
  question: string;
}

function getAnthropicApiKey(userId: string): string | null {
  const conn = getDb()
    .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'anthropic' ORDER BY created_at LIMIT 1")
    .get(userId) as { id: string } | undefined;
  if (!conn) return null;
  try {
    const cfg = getDecryptedConfig(conn.id, userId);
    return cfg.apiKey ?? null;
  } catch {
    return null;
  }
}

export async function runProjectQuery(input: ProjectQueryInput, userId: string): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return 'Space not found.';
  const repoItem = getItemById(input.item_id);
  if (!repoItem || repoItem.space_id !== space.id) return 'Repo item not found in this Space.';
  if (repoItem.type !== 'repo') return 'Selected item is not a repo.';

  const apiKey = getAnthropicApiKey(userId);
  const repoPath = repoItem.fields.repo_path as string;
  if (!await hasGraph(repoPath)) {
    await buildGraph(repoPath, input.item_id);
  }

  return await queryGraph(input.question, repoPath, apiKey);
}
