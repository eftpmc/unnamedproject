import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { listTriggers, createTrigger, deleteTrigger, type TriggerRecord } from '../services/triggers.js';
import { nextCronRun } from '../lib/cron.js';
import { fireTrigger } from '../services/triggerRunner.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

// List all triggers for this user across all their spaces
router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const rows = getDb().prepare(`
    SELECT t.*
    FROM triggers t
    JOIN spaces s ON t.space_id = s.id
    WHERE s.user_id = ?
    ORDER BY t.created_at DESC
  `).all(userId) as TriggerRecord[];
  res.json(rows);
});

// Create a trigger — requires a project_id to derive the space; falls back to first user space
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
  // Resolve space_id: if project_id given, look up its space; else use first user space
  let spaceId: string | undefined;
  if (project_id) {
    const row = getDb().prepare(`
      SELECT p.space_id FROM projects p
      JOIN spaces s ON p.space_id = s.id
      WHERE p.id = ? AND s.user_id = ?
    `).get(project_id, userId) as { space_id: string } | undefined;
    if (!row) { res.status(400).json({ error: 'Project not found' }); return; }
    spaceId = row.space_id;
  } else {
    const row = getDb().prepare('SELECT id FROM spaces WHERE user_id = ? LIMIT 1').get(userId) as { id: string } | undefined;
    if (!row) { res.status(400).json({ error: 'No space available — create a project first' }); return; }
    spaceId = row.id;
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
    space_id: spaceId,
    kind,
    schedule_cron: schedule_cron ?? null,
    playbook_id: playbook_id ?? null,
    next_run_at,
  }));
});

// Fire a trigger immediately (responds before the agent turn completes)
router.post('/:id/fire', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb().prepare(`
    SELECT t.id FROM triggers t
    JOIN spaces s ON t.space_id = s.id
    WHERE t.id = ? AND s.user_id = ?
  `).get(req.params.id, userId) as { id: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Trigger not found' }); return; }
  res.json({ status: 'firing' });
  fireTrigger(row.id).catch(err => console.error('[trigger/fire]', err));
});

// Toggle enabled state
router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled (boolean) required' }); return; }
  const row = getDb().prepare(`
    SELECT t.id FROM triggers t
    JOIN spaces s ON t.space_id = s.id
    WHERE t.id = ? AND s.user_id = ?
  `).get(req.params.id, userId) as { id: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Trigger not found' }); return; }
  getDb().prepare('UPDATE triggers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, row.id);
  const updated = getDb().prepare('SELECT * FROM triggers WHERE id = ?').get(row.id);
  res.json(updated);
});

// Delete a trigger (auth: must be in user's space)
router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb().prepare(`
    SELECT t.id FROM triggers t
    JOIN spaces s ON t.space_id = s.id
    WHERE t.id = ? AND s.user_id = ?
  `).get(req.params.id, userId) as { id: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Trigger not found' }); return; }
  deleteTrigger(row.id);
  res.status(204).end();
});

export default router;
