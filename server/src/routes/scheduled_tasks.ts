import { Router } from 'express';
import { getScheduledTasksForUser, getScheduledTaskForUser, updateScheduledTask, deleteScheduledTask } from '../db/index.js';
import { runScheduledTask } from '../services/scheduled_tasks.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json(getScheduledTasksForUser(userId));
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { enabled, interval_hours } = req.body as { enabled?: boolean; interval_hours?: number };

  const task = getScheduledTaskForUser(req.params.id, userId);
  if (!task) { res.status(404).json({ error: 'Scheduled task not found' }); return; }

  updateScheduledTask(req.params.id, userId, { enabled, interval_hours });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const task = getScheduledTaskForUser(req.params.id, userId);
  if (!task) { res.status(404).json({ error: 'Scheduled task not found' }); return; }
  deleteScheduledTask(req.params.id, userId);
  res.json({ ok: true });
});

router.post('/:id/run', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const task = getScheduledTaskForUser(req.params.id, userId);
  if (!task) { res.status(404).json({ error: 'Scheduled task not found' }); return; }

  try {
    await runScheduledTask(userId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Task run failed';
    res.status(500).json({ error: msg });
  }
});

export default router;
