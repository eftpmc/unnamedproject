import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDataDir } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let bundleLocationPromise: Promise<string> | null = null;

function getBundle(): Promise<string> {
  if (!bundleLocationPromise) {
    bundleLocationPromise = bundle({
      entryPoint: path.resolve(__dirname, '../../../remotion/src/index.tsx'),
    });
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
 * stored under the app's data directory (same root used for the sqlite db
 * and the default projects root), alongside `<dataDir>/projects/<id>/media/`.
 */
export function buildMediaPath(projectId: string, title: string): { dir: string; fileName: string } {
  const dir = path.join(getDataDir(), 'projects', projectId, 'media');
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
): Promise<string> {
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
    onProgress: ({ progress }) => onProgress?.(progress),
  });

  return fileName;
}
