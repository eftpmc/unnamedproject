import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDataDir } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProjectCapabilities {
  has_remotion: boolean;
  has_media: boolean;
}

export function detectCapabilities(projectId: string): ProjectCapabilities {
  // has_remotion: server-level — Remotion is a global composition, not per-project
  const remotionEntry = path.resolve(__dirname, '../../../remotion/src/index.tsx');
  const has_remotion = fs.existsSync(remotionEntry);

  // has_media: per-project — rendered videos stored in data dir
  const mediaDir = path.join(getDataDir(), 'projects', projectId, 'media');
  const has_media = fs.existsSync(mediaDir) && fs.readdirSync(mediaDir).length > 0;

  return { has_remotion, has_media };
}
