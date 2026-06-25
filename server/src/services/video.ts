import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDataDir } from '../db/index.js';
import { createFileItem } from './items.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let bundleLocationPromise: Promise<string> | null = null;

function getBundle(): Promise<string> {
  if (!bundleLocationPromise) {
    const pendingBundle = bundle({
      entryPoint: path.resolve(__dirname, '../../../remotion/src/index.tsx'),
    });
    if (!pendingBundle) throw new Error('Failed to create Remotion bundle');
    bundleLocationPromise = pendingBundle;
  }
  return bundleLocationPromise;
}

export interface VideoScene {
  text: string;
  durationInSeconds: number;
  imageUrl?: string;
}

/**
 * Generated video files are not part of a project's git repo, so they are
 * stored under the app's data directory and registered as a Space file item.
 */
export function buildMediaPath(projectId: string, title: string): { dir: string; fileName: string } {
  const dir = path.join(getDataDir(), 'spaces', projectId, 'files');
  const rawSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = rawSlug || 'video';
  const fileName = `${Date.now()}-${slug}.mp4`;
  return { dir, fileName };
}

export async function renderVideo(
  projectId: string,
  title: string,
  scenes: VideoScene[],
  onProgress?: (progress: number) => void,
  provenance?: { session_id?: string | null },
): Promise<string> {
  // Pre-flight: verify Remotion entry point exists before attempting to bundle
  const entryPoint = path.resolve(__dirname, '../../../remotion/src/index.tsx');
  if (!fs.existsSync(entryPoint)) {
    throw new Error(
      'Remotion is not configured on this server. To add video generation to a project, ' +
      'delegate to invoke_claude_code to scaffold the remotion/ directory with package.json, ' +
      'src/index.tsx, and src/Scenes.tsx, then install dependencies.'
    );
  }

  const serveUrl = await getBundle();
  const inputProps = { title, scenes };

  const composition = await selectComposition({ serveUrl, id: 'Scenes', inputProps });

  const { dir, fileName } = buildMediaPath(projectId, title);
  fs.mkdirSync(dir, { recursive: true });
  const outputLocation = path.join(dir, fileName);

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation,
    inputProps,
    onProgress: ({ progress }: { progress: number }) => onProgress?.(progress),
  });

  const stat = fs.statSync(outputLocation);
  createFileItem({
    space_id: projectId,
    name: title,
    file_path: outputLocation,
    size_bytes: stat.size,
    mime_type: 'video/mp4',
    source_session_id: provenance?.session_id ?? null,
  });

  return fileName;
}
