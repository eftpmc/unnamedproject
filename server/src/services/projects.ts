import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import { getDb, getProjectsRoot } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { projectFilesDir } from '../lib/spaceFs.js';
import { assertOutsideAppRoot, resolveWorkspacePath } from '../lib/workspacePaths.js';

export interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  repo_path: string;
  files_path: string;
  default_branch: string | null;
  origin: 'created' | 'linked';
  created_at: number;
  description: string | null;
  enabled_connection_ids: string[];
}

type RawProjectRow = Omit<ProjectRecord, 'enabled_connection_ids'> & { enabled_connection_ids: string };

function parseRow(row: RawProjectRow): ProjectRecord {
  return { ...row, enabled_connection_ids: JSON.parse(row.enabled_connection_ids || '[]') };
}

function insert(rec: Omit<ProjectRecord, 'description' | 'enabled_connection_ids'>): void {
  getDb().prepare(
    'INSERT INTO projects (id,user_id,name,repo_path,files_path,default_branch,origin,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(rec.id, rec.user_id, rec.name, rec.repo_path, rec.files_path, rec.default_branch, rec.origin, rec.created_at);
}

export async function createProject(input: { name: string; user_id: string }): Promise<ProjectRecord> {
  const id = newId();
  const projectsRoot = getProjectsRoot(input.user_id);
  assertOutsideAppRoot(projectsRoot, 'projects_root');
  const repoPath = path.join(projectsRoot, id);
  const filesPath = path.join(repoPath, 'files');
  await fs.mkdir(repoPath, { recursive: true });
  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.email', 'agent@localhost');
  await git.addConfig('user.name', 'Agent');
  insert({
    id, user_id: input.user_id, name: input.name, repo_path: repoPath, files_path: filesPath,
    default_branch: null, origin: 'created', created_at: Math.floor(Date.now() / 1000),
  });
  return getProject(id)!;
}

export function linkProject(input: { name: string; user_id: string; repo_path: string; default_branch?: string | null; files_path?: string }): ProjectRecord {
  const id = newId();
  const repoPath = resolveWorkspacePath(input.repo_path);
  assertOutsideAppRoot(repoPath, 'repo_path');
  const filesPath = input.files_path ?? projectFilesDir(id);
  const rec = {
    id, user_id: input.user_id, name: input.name, repo_path: repoPath, files_path: filesPath,
    default_branch: input.default_branch ?? null, origin: 'linked' as const, created_at: Math.floor(Date.now() / 1000),
  };
  insert(rec);
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(rec.id) as ProjectRecord;
}

export function getProject(id: string): ProjectRecord | undefined {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as RawProjectRow | undefined;
  return row ? parseRow(row) : undefined;
}

export function deleteProject(id: string): boolean {
  return getDb().prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}

export function listProjectsForUser(userId: string): ProjectRecord[] {
  const rows = getDb().prepare(`
    SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId) as RawProjectRow[];
  return rows.map(parseRow);
}

export function getProjectForUser(projectId: string, userId: string): ProjectRecord | undefined {
  const row = getDb()
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId) as RawProjectRow | undefined;
  return row ? parseRow(row) : undefined;
}
