import path from 'path';
import fs from 'fs/promises';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { listProjectsForUser, getProjectForUser, createProject, linkProject, deleteProject } from '../services/projects.js';
import { listFiles } from '../services/files.js';
import { buildGraph } from '../services/graphify.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

function resolveInRepo(repoPath: string, relPath: string): string {
  const root = path.resolve(repoPath);
  const resolved = path.resolve(root, relPath || '.');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes repository root');
  }
  return resolved;
}

router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  res.json(listProjectsForUser(userId));
});

router.post('/', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { name, repo_path, default_branch } = req.body as {
    name?: string;
    repo_path?: string;
    default_branch?: string | null;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name required' });
    return;
  }

  // Create a backing space (internal — not exposed in the API)
  const spaceId = newId();
  getDb().prepare(
    'INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?, ?, ?, NULL, ?)',
  ).run(spaceId, userId, name.trim(), '[]');

  let project;
  try {
    project = repo_path
      ? linkProject({ space_id: spaceId, name: name.trim(), repo_path, default_branch })
      : await createProject({ space_id: spaceId, name: name.trim() });
    // Stamp user_id/description/enabled_connection_ids directly on the project row
    getDb().prepare("UPDATE projects SET user_id = ?, enabled_connection_ids = '[]' WHERE id = ?").run(userId, project.id);
  } catch (err) {
    getDb().prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
    throw err;
  }

  const created = getProjectForUser(project.id, userId)!;
  // Fire-and-forget — don't block the response
  if (created.repo_path) {
    buildGraph(created.repo_path, created.id).catch(err =>
      console.error(`[projects] graph build failed for ${created.id}:`, err),
    );
  }
  res.status(201).json(created);
});

router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  res.json(project);
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const { name, default_branch, description, enabled_connection_ids } = req.body as {
    name?: string;
    default_branch?: string | null;
    description?: string | null;
    enabled_connection_ids?: string[];
  };

  const fields: string[] = [];
  const values: unknown[] = [];
  if (name?.trim()) { fields.push('name = ?'); values.push(name.trim()); }
  if (default_branch !== undefined) { fields.push('default_branch = ?'); values.push(default_branch); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (enabled_connection_ids !== undefined) { fields.push('enabled_connection_ids = ?'); values.push(JSON.stringify(enabled_connection_ids)); }

  if (fields.length > 0) {
    values.push(project.id);
    getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    // Keep spaces table in sync (used internally for FS paths and legacy FKs)
    const spaceFields: string[] = [];
    const spaceValues: unknown[] = [];
    if (name?.trim()) { spaceFields.push('name = ?'); spaceValues.push(name.trim()); }
    if (description !== undefined) { spaceFields.push('description = ?'); spaceValues.push(description); }
    if (enabled_connection_ids !== undefined) { spaceFields.push('enabled_connection_ids = ?'); spaceValues.push(JSON.stringify(enabled_connection_ids)); }
    if (spaceFields.length > 0) {
      spaceValues.push(project.space_id);
      getDb().prepare(`UPDATE spaces SET ${spaceFields.join(', ')} WHERE id = ?`).run(...spaceValues);
    }
  }

  res.json(getProjectForUser(req.params.id, userId));
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  deleteProject(project.id);
  getDb().prepare('DELETE FROM spaces WHERE id = ?').run(project.space_id);
  res.status(204).end();
});

// Files scoped to project
router.get('/:id/files', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const { type } = req.query as Record<string, string>;
  const files = listFiles(project.space_id, type ? { type } : undefined);
  res.json(files);
});

router.get('/:id/tree', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const relPath = (req.query.path as string | undefined) ?? '';
  let dir: string;
  try { dir = resolveInRepo(project.repo_path, relPath); } catch {
    res.status(400).json({ error: 'Invalid path' }); return;
  }
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const prefix = relPath ? `${relPath}/` : '';
    res.json({ entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', path: `${prefix}${e.name}` })) });
  } catch {
    res.status(404).json({ error: 'Path not found' });
  }
});

router.get('/:id/file', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const relPath = (req.query.path as string | undefined) ?? '';
  let filePath: string;
  try { filePath = resolveInRepo(project.repo_path, relPath); } catch {
    res.status(400).json({ error: 'Invalid path' }); return;
  }
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ path: relPath, content });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

export default router;
