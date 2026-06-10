import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { title } = req.body as { title?: string };
  const id = newId();
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)')
    .run(id, userId, title ?? null);
  res.status(201).json({ id });
});

export default router;
