import fs from 'fs/promises';
import path from 'path';
import { getProjectForUser, getDataDir } from '../db/index.js';
import { requestApproval } from '../services/executor.js';
import { ensureWorktree } from '../lib/worktree.js';

interface ToolContext {
  userId: string;
  executionId: string;
  projectId: string;
  sessionId: string;
}

function resolveInProject(repoPath: string, relPath: string): string {
  const resolved = path.resolve(repoPath, relPath);
  const repoResolved = path.resolve(repoPath);
  if (resolved !== repoResolved && !resolved.startsWith(repoResolved + path.sep)) {
    throw new Error('Path escapes project root');
  }
  return resolved;
}

async function getWorkspacePath(projectId: string, userId: string, sessionId: string): Promise<string> {
  const project = getProjectForUser(projectId, userId);
  if (!project) throw new Error('Project not found');
  if (!project.repo_path) {
    // Doc project: use a managed flat directory, no git/worktree needed
    const dir = path.join(getDataDir(), 'doc-projects', projectId, 'files');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
  return (await ensureWorktree(project, sessionId)).worktree_path;
}

export async function readFile(input: { project_id: string; path: string }, ctx: ToolContext): Promise<string> {
  const repoPath = await getWorkspacePath(input.project_id, ctx.userId, ctx.sessionId);
  const target = resolveInProject(repoPath, input.path);
  return await fs.readFile(target, 'utf-8');
}

export async function listDir(input: { project_id: string; path?: string }, ctx: ToolContext): Promise<string> {
  const repoPath = await getWorkspacePath(input.project_id, ctx.userId, ctx.sessionId);
  const target = resolveInProject(repoPath, input.path ?? '.');
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n');
}

export async function writeFile(input: { project_id: string; path: string; content: string }, ctx: ToolContext): Promise<string> {
  const repoPath = await getWorkspacePath(input.project_id, ctx.userId, ctx.sessionId);
  const target = resolveInProject(repoPath, input.path);

  const decision = await requestApproval(ctx.executionId, ctx.userId, 'write_file', { path: input.path } as Record<string, unknown>, 'user');
  if (decision === 'rejected') return 'write_file cancelled';

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, input.content, 'utf-8');
  return `wrote ${input.content.length} bytes to ${input.path}`;
}
