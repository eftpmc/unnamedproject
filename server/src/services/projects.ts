import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { projectsDir } from '../lib/spaceFs.js';

export interface ProjectRecord {
  id: string;
  space_id: string;
  name: string;
  repo_path: string;
  default_branch: string | null;
  origin: 'created' | 'linked';
  created_at: number;
}

function insert(rec: ProjectRecord): void {
  getDb().prepare(
    'INSERT INTO projects (id,space_id,name,repo_path,default_branch,origin,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(rec.id, rec.space_id, rec.name, rec.repo_path, rec.default_branch, rec.origin, rec.created_at);
}

export async function createProject(input: { space_id: string; name: string }): Promise<ProjectRecord> {
  const id = newId();
  const repoPath = path.join(projectsDir(input.space_id), id);
  await fs.mkdir(repoPath, { recursive: true });
  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.email', 'agent@localhost');
  await git.addConfig('user.name', 'Agent');
  const rec: ProjectRecord = {
    id, space_id: input.space_id, name: input.name, repo_path: repoPath,
    default_branch: null, origin: 'created', created_at: Math.floor(Date.now() / 1000),
  };
  insert(rec);
  return rec;
}

export function linkProject(input: { space_id: string; name: string; repo_path: string; default_branch?: string | null }): ProjectRecord {
  const rec: ProjectRecord = {
    id: newId(), space_id: input.space_id, name: input.name, repo_path: input.repo_path,
    default_branch: input.default_branch ?? null, origin: 'linked', created_at: Math.floor(Date.now() / 1000),
  };
  insert(rec);
  return rec;
}

export function listProjects(spaceId: string): ProjectRecord[] {
  return getDb().prepare('SELECT * FROM projects WHERE space_id = ? ORDER BY created_at DESC').all(spaceId) as ProjectRecord[];
}

export function getProject(id: string): ProjectRecord | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRecord | undefined;
}

export function deleteProject(id: string): boolean {
  return getDb().prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}

export function listProjectsForUser(userId: string): ProjectRecord[] {
  return getDb().prepare(`
    SELECT p.*
    FROM projects p
    JOIN spaces s ON p.space_id = s.id
    WHERE s.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId) as ProjectRecord[];
}

export function getProjectForUser(projectId: string, userId: string): ProjectRecord | undefined {
  return getDb().prepare(`
    SELECT p.*
    FROM projects p
    JOIN spaces s ON p.space_id = s.id
    WHERE p.id = ? AND s.user_id = ?
  `).get(projectId, userId) as ProjectRecord | undefined;
}
