import { Router } from 'express';
import { getScheduledTasksForUser, getScheduledTaskForUser, updateScheduledTask, deleteScheduledTask, createScheduledTask } from '../db/index.js';
import { runScheduledTask } from '../services/scheduled_tasks.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json(getScheduledTasksForUser(userId));
});

router.post('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { type, interval_hours, prompt, pinned_space_id } = req.body as { type: string; interval_hours: number; prompt?: string; pinned_space_id?: string };
  if (!type || !interval_hours || interval_hours < 1) {
    res.status(400).json({ error: 'type and interval_hours (≥1) are required' }); return;
  }
  if (type === 'custom_prompt' && !prompt) {
    res.status(400).json({ error: 'prompt is required for custom_prompt tasks' }); return;
  }
  const id = createScheduledTask(userId, type, interval_hours, prompt, pinned_space_id);
  res.status(201).json({ id });
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { enabled, interval_hours, pinned_space_id } = req.body as { enabled?: boolean; interval_hours?: number; pinned_space_id?: string | null };

  const task = getScheduledTaskForUser(req.params.id, userId);
  if (!task) { res.status(404).json({ error: 'Scheduled task not found' }); return; }

  updateScheduledTask(req.params.id, userId, { enabled, interval_hours, ...('pinned_space_id' in req.body ? { pinned_space_id } : {}) });
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
