import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getDb, getDataDir, getCampaignsForProject } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids, created_at FROM projects WHERE user_id = ? ORDER BY name')
    .all(userId) as any[];
  res.json(rows.map(r => ({ ...r, enabled_connection_ids: JSON.parse(r.enabled_connection_ids) })));
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { name, description, repo_path, enabled_connection_ids = [] } = req.body as {
    name?: string; description?: string; repo_path?: string; enabled_connection_ids?: string[];
  };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  const id = newId();
  try {
    getDb()
      .prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(id, userId, name, description ?? null, repo_path ?? null, JSON.stringify(enabled_connection_ids));
  } catch {
    res.status(409).json({ error: 'Project name already exists' });
    return;
  }
  res.status(201).json({ id });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const result = getDb()
    .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(204).send();
});

function getProjectBasePath(project: { id: string; repo_path: string | null }): string | null {
  if (project.repo_path) return project.repo_path;
  const dir = path.join(getDataDir(), 'doc-projects', project.id, 'files');
  return dir;
}

function resolveInProject(base: string, relPath: string): string {
  const resolved = path.resolve(base, relPath || '.');
  const baseResolved = path.resolve(base);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
    throw new Error('Path escapes project root');
  }
  return resolved;
}

router.get('/:id/tree', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id, repo_path FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; repo_path: string | null } | undefined;
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const base = getProjectBasePath(project);
  if (!base) { res.json({ entries: [] }); return; }

  try {
    await fs.mkdir(base, { recursive: true });
    const target = resolveInProject(base, (req.query.path as string) || '');
    const entries = await fs.readdir(target, { withFileTypes: true });
    const result = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', path: path.relative(base, path.join(target, e.name)) }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    res.json({ entries: result, base_is_repo: !!project.repo_path });
  } catch {
    res.json({ entries: [], base_is_repo: !!project.repo_path });
  }
});

router.get('/:id/file', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id, repo_path FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; repo_path: string | null } | undefined;
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const base = getProjectBasePath(project);
  if (!base) { res.status(404).json({ error: 'No files directory' }); return; }

  const filePath = (req.query.path as string) || '';
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  try {
    const target = resolveInProject(base, filePath);
    const content = await fs.readFile(target, 'utf-8');
    res.json({ content, path: filePath });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

router.get('/:id/campaigns', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(getCampaignsForProject(req.params.id));
});

export default router;
