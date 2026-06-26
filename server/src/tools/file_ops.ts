import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getSpaceForUser } from '../db/index.js';
import { getItemById, type RepoItem } from '../services/items.js';
import { requestApproval } from '../services/executor.js';
import { ensureWorktree } from '../lib/worktree.js';
import type { PermissionProfile } from '../services/permissions.js';

interface ToolContext {
  userId: string;
  executionId: string;
  sessionId: string;
  permissionProfile?: PermissionProfile;
}

function resolveInProject(repoPath: string, relPath: string): string {
  const resolved = path.resolve(repoPath, relPath);
  const repoResolved = path.resolve(repoPath);
  if (resolved !== repoResolved && !resolved.startsWith(repoResolved + path.sep)) {
    throw new Error('Path escapes project root');
  }
  return resolved;
}

async function getWorkspacePath(spaceId: string, itemId: string, userId: string, sessionId: string): Promise<string> {
  const space = getSpaceForUser(spaceId, userId);
  if (!space) throw new Error('Space not found');
  const repoItem = getItemById(itemId);
  if (!repoItem || repoItem.space_id !== spaceId) throw new Error('Repo item not found in this Space');
  if (repoItem.type !== 'repo') throw new Error(`Item ${itemId} is not a repo`);
  return (await ensureWorktree(repoItem as RepoItem, sessionId)).worktree_path;
}

const FILE_LINE_CAP = 500;

export async function readFile(input: { space_id: string; item_id: string; path: string; offset?: number; limit?: number }, ctx: ToolContext): Promise<string> {
  const repoPath = await getWorkspacePath(input.space_id, input.item_id, ctx.userId, ctx.sessionId);
  const target = resolveInProject(repoPath, input.path);
  const content = await fs.readFile(target, 'utf-8');
  const lines = content.split('\n');
  const totalLines = lines.length;
  const start = Math.max(0, (input.offset ?? 1) - 1);
  const end = input.limit !== undefined ? start + input.limit : Math.min(start + FILE_LINE_CAP, totalLines);
  const slice = lines.slice(start, end).join('\n');
  const header = end < totalLines || start > 0
    ? `[lines ${start + 1}–${Math.min(end, totalLines)} of ${totalLines}${end < totalLines ? ` — use offset/limit to read more` : ''}]\n`
    : '';
  return header + slice;
}

export async function listDir(input: { space_id: string; item_id: string; path?: string }, ctx: ToolContext): Promise<string> {
  const repoPath = await getWorkspacePath(input.space_id, input.item_id, ctx.userId, ctx.sessionId);
  const target = resolveInProject(repoPath, input.path ?? '.');
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n');
}

export async function searchFiles(
  input: { space_id: string; item_id: string; pattern: string; path?: string; file_glob?: string; ignore_case?: boolean },
  ctx: ToolContext,
): Promise<string> {
  const repoPath = await getWorkspacePath(input.space_id, input.item_id, ctx.userId, ctx.sessionId);
  const searchRoot = resolveInProject(repoPath, input.path ?? '.');

  const flags = input.ignore_case ? 'i' : '';
  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern, flags);
  } catch {
    regex = new RegExp(input.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }

  const fileGlob = input.file_glob;
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__']);
  const MAX_MATCHES = 50;
  const matches: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (matches.length >= MAX_MATCHES) return;
    let entries: fsSync.Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (matches.length >= MAX_MATCHES) return;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (fileGlob && !entry.name.match(new RegExp(fileGlob.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i'))) continue;
      const filePath = path.join(dir, entry.name);
      let text: string;
      try { text = await fs.readFile(filePath, 'utf-8'); } catch { continue; }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
        if (regex.test(lines[i])) {
          const rel = path.relative(repoPath, filePath);
          matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }
  }

  await walk(searchRoot);
  if (matches.length === 0) return `No matches for /${input.pattern}/ in ${input.path ?? '.'}`;
  const truncated = matches.length === MAX_MATCHES ? `\n(capped at ${MAX_MATCHES} matches — refine your pattern if needed)` : '';
  return matches.join('\n') + truncated;
}

export async function writeFile(input: { space_id: string; item_id: string; path: string; content: string }, ctx: ToolContext): Promise<string> {
  const repoPath = await getWorkspacePath(input.space_id, input.item_id, ctx.userId, ctx.sessionId);
  const target = resolveInProject(repoPath, input.path);

  const tier = (ctx.permissionProfile ?? 'fast') === 'strict' ? 'user' : 'agent';
  const decision = await requestApproval(ctx.executionId, ctx.userId, 'write_file', { path: input.path } as Record<string, unknown>, tier);
  if (decision === 'rejected') return 'write_file cancelled';

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, input.content, 'utf-8');
  return `wrote ${input.content.length} bytes to ${input.path}`;
}
