import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { createTrigger, deleteTrigger, getTrigger, listTriggersByUser, listTriggerRuns, type TriggerRecord } from '../services/triggers.js';
import { nextCronRun } from '../lib/cron.js';
import { fireTrigger } from '../services/triggerRunner.js';
import { logger } from '../lib/logger.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  res.json(listTriggersByUser(userId));
});

router.post('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { kind, schedule_cron, playbook_id, project_id } = req.body as {
    kind?: 'schedule' | 'webhook' | 'manual';
    schedule_cron?: string | null;
    playbook_id?: string | null;
    project_id?: string | null;
  };
  if (!kind || !['schedule', 'webhook', 'manual'].includes(kind)) {
    res.status(400).json({ error: 'kind required (schedule|webhook|manual)' });
    return;
  }

  const projectRow = project_id
    ? getDb().prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(project_id, userId) as { id: string } | undefined
    : getDb().prepare('SELECT id FROM projects WHERE user_id = ? LIMIT 1').get(userId) as { id: string } | undefined;

  if (!projectRow) {
    res.status(400).json({ error: project_id ? 'Project not found' : 'No project available — create one first' });
    return;
  }

  let next_run_at: number | null = null;
  if (kind === 'schedule' && schedule_cron) {
    try {
      next_run_at = nextCronRun(schedule_cron, Math.floor(Date.now() / 1000));
    } catch {
      res.status(400).json({ error: 'invalid schedule_cron expression' });
      return;
    }
  }

  res.status(201).json(createTrigger({
    project_id: projectRow.id,
    kind,
    schedule_cron: schedule_cron ?? null,
    playbook_id: playbook_id ?? null,
    next_run_at,
  }));
});

function authTrigger(triggerId: string, userId: string): TriggerRecord | undefined {
  const t = getTrigger(triggerId);
  if (!t) return undefined;
  const owned = getDb().prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(t.project_id, userId);
  return owned ? t : undefined;
}

router.get('/:id/runs', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  if (!authTrigger(req.params.id, userId)) { res.status(404).json({ error: 'Trigger not found' }); return; }
  res.json(listTriggerRuns(req.params.id));
});

router.post('/:id/fire', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  if (!authTrigger(req.params.id, userId)) { res.status(404).json({ error: 'Trigger not found' }); return; }
  try {
    const sessionId = await fireTrigger(req.params.id);
    res.json({ status: 'firing', sessionId });
  } catch (err) {
    logger.error('[trigger/fire]', { triggerId: req.params.id, err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fire trigger' });
  }
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { enabled, playbook_id } = req.body as { enabled?: boolean; playbook_id?: string | null };
  if (enabled === undefined && playbook_id === undefined) {
    res.status(400).json({ error: 'enabled or playbook_id required' });
    return;
  }
  if (!authTrigger(req.params.id, userId)) { res.status(404).json({ error: 'Trigger not found' }); return; }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (typeof enabled === 'boolean') { fields.push('enabled = ?'); values.push(enabled ? 1 : 0); }
  if (playbook_id !== undefined) { fields.push('playbook_id = ?'); values.push(playbook_id ?? null); }
  values.push(req.params.id);
  getDb().prepare(`UPDATE triggers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json(getTrigger(req.params.id));
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  if (!authTrigger(req.params.id, userId)) { res.status(404).json({ error: 'Trigger not found' }); return; }
  deleteTrigger(req.params.id);
  res.status(204).end();
});

export default router;
