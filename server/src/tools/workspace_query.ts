import { queryGraph } from '../services/graphify.js';
import { getWorkspaceForUser } from '../db/index.js';

interface WorkspaceQueryInput {
  workspace_id: string;
  question: string;
}

export async function runWorkspaceQuery(input: WorkspaceQueryInput, userId: string): Promise<string> {
  const ws = getWorkspaceForUser(input.workspace_id, userId);

  if (!ws?.repo_path) {
    return 'Workspace has no repo path configured.';
  }

  return await queryGraph(ws.repo_path, input.question);
}
