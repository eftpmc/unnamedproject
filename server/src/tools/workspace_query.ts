import { queryGraph } from '../services/graphify.js';
import { getDb } from '../db/index.js';

interface WorkspaceQueryInput {
  workspace_id: string;
  question: string;
}

interface WorkspaceRow {
  repo_path: string | null;
}

export async function runWorkspaceQuery(input: WorkspaceQueryInput): Promise<string> {
  const ws = getDb()
    .prepare('SELECT repo_path FROM workspaces WHERE id = ?')
    .get(input.workspace_id) as WorkspaceRow | undefined;

  if (!ws?.repo_path) {
    return 'Workspace has no repo path configured.';
  }

  return await queryGraph(ws.repo_path, input.question);
}
