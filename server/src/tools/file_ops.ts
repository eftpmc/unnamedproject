import fs from 'fs/promises';
import path from 'path';
import { getWorkspaceForUser } from '../db/index.js';
import { requestApproval } from '../services/executor.js';

interface ToolContext {
  userId: string;
  executionId: string;
  workspaceId: string;
}

function resolveInWorkspace(repoPath: string, relPath: string): string {
  const resolved = path.resolve(repoPath, relPath);
  const repoResolved = path.resolve(repoPath);
  if (resolved !== repoResolved && !resolved.startsWith(repoResolved + path.sep)) {
    throw new Error('Path escapes workspace root');
  }
  return resolved;
}

function getRepoPath(workspaceId: string, userId: string): string {
  const ws = getWorkspaceForUser(workspaceId, userId);
  if (!ws) throw new Error('Workspace not found');
  if (!ws.repo_path) throw new Error('Workspace has no repo path configured');
  return ws.repo_path;
}

export async function readFile(input: { workspace_id: string; path: string }, ctx: ToolContext): Promise<string> {
  const repoPath = getRepoPath(input.workspace_id, ctx.userId);
  const target = resolveInWorkspace(repoPath, input.path);
  return await fs.readFile(target, 'utf-8');
}

export async function listDir(input: { workspace_id: string; path?: string }, ctx: ToolContext): Promise<string> {
  const repoPath = getRepoPath(input.workspace_id, ctx.userId);
  const target = resolveInWorkspace(repoPath, input.path ?? '.');
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n');
}

export async function writeFile(input: { workspace_id: string; path: string; content: string }, ctx: ToolContext): Promise<string> {
  const repoPath = getRepoPath(input.workspace_id, ctx.userId);
  const target = resolveInWorkspace(repoPath, input.path);

  const decision = await requestApproval(ctx.executionId, ctx.userId, 'write_file', { path: input.path } as Record<string, unknown>, 'user');
  if (decision === 'rejected') return 'write_file cancelled';

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, input.content, 'utf-8');
  return `wrote ${input.content.length} bytes to ${input.path}`;
}
