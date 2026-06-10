import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids, created_at FROM workspaces WHERE user_id = ? ORDER BY name')
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
      .prepare('INSERT INTO workspaces (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(id, userId, name, description ?? null, repo_path ?? null, JSON.stringify(enabled_connection_ids));
  } catch {
    res.status(409).json({ error: 'Workspace name already exists' });
    return;
  }
  res.status(201).json({ id });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as AuthedRequest;
  const result = getDb()
    .prepare('DELETE FROM workspaces WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(204).send();
});

export default router;
