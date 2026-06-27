import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

function spaceForUser(spaceId: string, userId: string): { id: string; name: string } | undefined {
  return getDb().prepare(
    'SELECT id, name FROM spaces WHERE id = ? AND user_id = ?',
  ).get(spaceId, userId) as { id: string; name: string } | undefined;
}

router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const rows = getDb().prepare(`
    SELECT id, name, description, enabled_connection_ids, created_at
    FROM spaces
    WHERE user_id = ?
    ORDER BY name
  `).all(userId) as Array<Record<string, unknown> & { enabled_connection_ids: string }>;
  res.json(rows.map(row => ({
    ...row,
    enabled_connection_ids: JSON.parse(row.enabled_connection_ids),
  })));
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { name, description, enabled_connection_ids = [] } = req.body as {
    name?: string;
    description?: string;
    enabled_connection_ids?: string[];
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name required' });
    return;
  }
  const id = newId();
  try {
    getDb().prepare(`
      INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, name.trim(), description ?? null, JSON.stringify(enabled_connection_ids));
  } catch {
    res.status(409).json({ error: 'Space name already exists' });
    return;
  }
  res.status(201).json({ id, name: name.trim() });
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  if (!spaceForUser(req.params.id, userId)) {
    res.status(404).json({ error: 'Space not found' });
    return;
  }
  const { description, name, enabled_connection_ids } = req.body as {
    description?: string | null;
    name?: string;
    enabled_connection_ids?: string[];
  };
  const fields: string[] = [];
  const values: unknown[] = [];
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (name?.trim()) { fields.push('name = ?'); values.push(name.trim()); }
  if (enabled_connection_ids !== undefined) {
    fields.push('enabled_connection_ids = ?');
    values.push(JSON.stringify(enabled_connection_ids));
  }
  if (fields.length > 0) {
    values.push(req.params.id, userId);
    getDb().prepare(
      `UPDATE spaces SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    ).run(...values);
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const result = getDb().prepare('DELETE FROM spaces WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Space not found' });
    return;
  }
  res.status(204).end();
});

export default router;
