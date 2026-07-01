import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import { defaultProjectFilesRoot } from './workspacePaths.js';

export function projectFilesDir(projectId: string): string {
  return path.join(defaultProjectFilesRoot(), projectId);
}

export async function ensureFilesRepo(filesPath: string): Promise<void> {
  await fs.mkdir(filesPath, { recursive: true });
  const git = simpleGit(filesPath);
  if (!(await git.checkIsRepo())) {
    await git.init();
    await git.addConfig('user.email', 'agent@localhost');
    await git.addConfig('user.name', 'Agent');
  }
}

export async function commitFiles(filesPath: string, message: string): Promise<void> {
  const git = simpleGit(filesPath);
  await git.add('-A');
  const status = await git.status();
  if (status.staged.length === 0) return;
  await git.commit(message);
}

export function resolveInFiles(filesPath: string, relPath: string): string {
  const root = path.resolve(filesPath);
  const resolved = path.resolve(root, relPath || '.');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes files root');
  }
  return resolved;
}
