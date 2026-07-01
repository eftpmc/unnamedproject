import { Router } from 'express';
import { getDb } from '../db/index.js';
import { fireTrigger } from '../services/triggerRunner.js';
import { logger } from '../lib/logger.js';

const router = Router();

// POST /webhooks/trigger/:triggerId
// Fire a trigger from any external system. No auth — the triggerId acts as the secret.
// Responds immediately; runs the trigger in the background.
router.post('/trigger/:triggerId', (req, res) => {
  const { triggerId } = req.params;
  const trigger = getDb()
    .prepare('SELECT id FROM triggers WHERE id = ?')
    .get(triggerId) as { id: string } | undefined;

  if (!trigger) {
    res.status(404).json({ error: 'Trigger not found' });
    return;
  }

  res.json({ ok: true, triggerId });
  fireTrigger(triggerId).catch(err =>
    logger.error('[webhook] fireTrigger failed', { triggerId, err: err instanceof Error ? err.message : String(err) }),
  );
});

export default router;
