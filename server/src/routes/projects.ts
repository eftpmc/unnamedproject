import path from 'path';
import fs from 'fs/promises';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { listProjectsForUser, getProjectForUser, createProject, linkProject, deleteProject } from '../services/projects.js';

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

// List all projects for the authenticated user
router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  res.json(listProjectsForUser(userId));
});

// Create or link a project (auto-creates a backing space)
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
  // Auto-create a backing space for this project
  const spaceId = newId();
  getDb().prepare(
    'INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?, ?, ?, NULL, ?)',
  ).run(spaceId, userId, name.trim(), '[]');

  let project;
  try {
    project = repo_path
      ? linkProject({ space_id: spaceId, name: name.trim(), repo_path, default_branch }) // linkProject is synchronous
      : await createProject({ space_id: spaceId, name: name.trim() });
  } catch (err) {
    // Roll back the orphaned space if project creation fails
    getDb().prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
    throw err;
  }

  res.status(201).json(project);
});

// Get a single project
router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  res.json(project);
});

// Update project fields (name, default_branch) and space fields (description, enabled_connection_ids)
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

  const projFields: string[] = [];
  const projValues: unknown[] = [];
  if (name?.trim()) { projFields.push('name = ?'); projValues.push(name.trim()); }
  if (default_branch !== undefined) { projFields.push('default_branch = ?'); projValues.push(default_branch); }
  if (projFields.length > 0) {
    projValues.push(project.id);
    getDb().prepare(`UPDATE projects SET ${projFields.join(', ')} WHERE id = ?`).run(...projValues);
  }

  const spaceFields: string[] = [];
  const spaceValues: unknown[] = [];
  if (name?.trim()) { spaceFields.push('name = ?'); spaceValues.push(name.trim()); }
  if (description !== undefined) { spaceFields.push('description = ?'); spaceValues.push(description); }
  if (enabled_connection_ids !== undefined) { spaceFields.push('enabled_connection_ids = ?'); spaceValues.push(JSON.stringify(enabled_connection_ids)); }
  if (spaceFields.length > 0) {
    spaceValues.push(project.space_id);
    getDb().prepare(`UPDATE spaces SET ${spaceFields.join(', ')} WHERE id = ?`).run(...spaceValues);
  }

  res.json(getProjectForUser(req.params.id, userId));
});

// Delete project and its backing space
router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  deleteProject(project.id);
  getDb().prepare('DELETE FROM spaces WHERE id = ?').run(project.space_id);
  res.status(204).end();
});

// File browser — directory listing
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

// File browser — file content
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
