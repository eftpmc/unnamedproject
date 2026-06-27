import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import { getDataDir } from '../db/index.js';

export function spaceDir(spaceId: string): string {
  return path.join(getDataDir(), 'spaces', spaceId);
}

export function documentsDir(spaceId: string): string {
  return path.join(spaceDir(spaceId), 'documents');
}

export function projectsDir(spaceId: string): string {
  return path.join(spaceDir(spaceId), 'projects');
}

export async function ensureDocumentsRepo(spaceId: string): Promise<void> {
  const dir = documentsDir(spaceId);
  await fs.mkdir(dir, { recursive: true });
  const git = simpleGit(dir);
  if (!(await git.checkIsRepo())) {
    await git.init();
    // Identity so commits succeed in headless/CI environments.
    await git.addConfig('user.email', 'agent@localhost');
    await git.addConfig('user.name', 'Agent');
  }
}

export async function commitDocuments(spaceId: string, message: string): Promise<void> {
  const git = simpleGit(documentsDir(spaceId));
  await git.add('-A');
  const status = await git.status();
  if (status.staged.length === 0) return;
  await git.commit(message);
}

export function resolveInDocuments(spaceId: string, relPath: string): string {
  const root = path.resolve(documentsDir(spaceId));
  const resolved = path.resolve(root, relPath || '.');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes documents root');
  }
  return resolved;
}
