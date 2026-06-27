import { getDb, getSpaceForUser } from '../db/index.js';
import { getProject } from '../services/projects.js';
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
  const project = getProject(input.item_id);
  if (!project || project.space_id !== space.id) return 'Project not found in this Space.';

  const apiKey = getAnthropicApiKey(userId);
  const repoPath = project.repo_path;
  if (!await hasGraph(repoPath)) {
    await buildGraph(repoPath, project.id);
  }

  return await queryGraph(input.question, repoPath, apiKey);
}
