import * as fs from 'fs';
import * as path from 'path';

export interface ProjectCapabilities {
  has_graph: boolean;
}

export function detectCapabilities(_projectId: string, repoPath?: string | null): ProjectCapabilities {
  const has_graph = repoPath
    ? fs.existsSync(path.join(repoPath, '.project-index.json'))
    : false;

  return { has_graph };
}
