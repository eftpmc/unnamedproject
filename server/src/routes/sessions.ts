import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { DEFAULT_EFFORT, isEffortLevel, getModelsForEffort } from '../services/anthropic.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, title, effort, model, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId);
  res.json(rows);
});

router.get('/models', async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { effort } = req.query as { effort?: string };
  if (!isEffortLevel(effort)) {
    res.status(400).json({ error: 'effort must be one of: low, medium, high' });
    return;
  }
  try {
    const models = await getModelsForEffort(userId, effort);
    res.json(models);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { effort, model, title } = req.body as { effort?: string; model?: string | null; title?: string };

  if (effort === undefined && model === undefined && title === undefined) {
    res.status(400).json({ error: 'effort, model, or title required' });
    return;
  }
  if (effort !== undefined && !isEffortLevel(effort)) {
    res.status(400).json({ error: 'effort must be one of: low, medium, high' });
    return;
  }
  if (model !== undefined && model !== null && typeof model !== 'string') {
    res.status(400).json({ error: 'model must be a string or null' });
    return;
  }

  const session = getDb().prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  if (effort !== undefined) {
    getDb().prepare('UPDATE sessions SET effort = ? WHERE id = ?').run(effort, req.params.id);
  }
  if (model !== undefined) {
    getDb().prepare('UPDATE sessions SET model = ? WHERE id = ?').run(model, req.params.id);
  }
  if (title !== undefined) {
    getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, req.params.id);
  }
  res.json({ ok: true });
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { title } = req.body as { title?: string };
  const id = newId();
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, title, effort) VALUES (?,?,?,?)')
    .run(id, userId, title ?? null, DEFAULT_EFFORT);
  res.status(201).json({ id });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
