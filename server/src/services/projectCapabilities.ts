import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDataDir } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProjectCapabilities {
  has_remotion: boolean;
  has_media: boolean;
  has_graph: boolean;
}

export function detectCapabilities(projectId: string, repoPath?: string | null): ProjectCapabilities {
  // has_remotion: server-level — Remotion is a global composition, not per-project
  const remotionEntry = path.resolve(__dirname, '../../../remotion/src/index.tsx');
  const has_remotion = fs.existsSync(remotionEntry);

  // has_media: per-project — check new data-dir path first, then repo out/ as fallback
  const mediaDir = path.join(getDataDir(), 'projects', projectId, 'media');
  let has_media = fs.existsSync(mediaDir) && fs.readdirSync(mediaDir).length > 0;

  if (!has_media && repoPath) {
    const outDir = path.join(repoPath, 'out');
    has_media = fs.existsSync(outDir) && fs.readdirSync(outDir).some(f => f.toLowerCase().endsWith('.mp4'));
  }

  // has_graph: per-project — graphify writes graph.json here when rebuild_graph is run
  const has_graph = repoPath
    ? fs.existsSync(path.join(repoPath, 'graphify-out', 'graph.json'))
    : false;

  return { has_remotion, has_media, has_graph };
}
