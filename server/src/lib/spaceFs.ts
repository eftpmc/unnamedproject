import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { getDataDir } from '../db/index.js';

export function spaceDir(spaceId: string): string {
  return path.join(getDataDir(), 'spaces', spaceId);
}

export function filesDir(spaceId: string): string {
  return path.join(spaceDir(spaceId), 'files');
}

export function projectsDir(spaceId: string): string {
  return path.join(spaceDir(spaceId), 'projects');
}

async function migrateDocsToFiles(spaceId: string): Promise<void> {
  const oldDir = path.join(spaceDir(spaceId), 'documents');
  const newDir = filesDir(spaceId);
  if (fsSync.existsSync(oldDir) && !fsSync.existsSync(newDir)) {
    await fs.rename(oldDir, newDir);
  }
}

export async function ensureFilesRepo(spaceId: string): Promise<void> {
  await migrateDocsToFiles(spaceId);
  const dir = filesDir(spaceId);
  await fs.mkdir(dir, { recursive: true });
  const git = simpleGit(dir);
  if (!(await git.checkIsRepo())) {
    await git.init();
    await git.addConfig('user.email', 'agent@localhost');
    await git.addConfig('user.name', 'Agent');
  }
}

export async function commitFiles(spaceId: string, message: string): Promise<void> {
  const git = simpleGit(filesDir(spaceId));
  await git.add('-A');
  const status = await git.status();
  if (status.staged.length === 0) return;
  await git.commit(message);
}

export function resolveInFiles(spaceId: string, relPath: string): string {
  const root = path.resolve(filesDir(spaceId));
  const resolved = path.resolve(root, relPath || '.');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes files root');
  }
  return resolved;
}
