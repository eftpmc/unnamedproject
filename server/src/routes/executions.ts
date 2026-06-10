import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { resolveApproval } from '../lib/approval.js';

const router = Router();
router.use(requireAuth);

router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const execution = getDb()
    .prepare(`
      SELECT e.id, e.tool, e.status, e.output_log, e.result, e.created_at, e.completed_at,
             e.workspace_id, a.id as approval_id, a.action, a.payload
      FROM executions e
      LEFT JOIN approvals a ON a.execution_id = e.id AND a.status = 'pending'
      LEFT JOIN messages m ON m.id = e.message_id
      LEFT JOIN threads t ON t.id = m.thread_id
      WHERE e.id = ? AND t.user_id = ?
    `)
    .get(req.params.id, userId);
  if (!execution) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(execution);
});

router.post('/:id/approve', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const approval = getDb()
    .prepare(`
      SELECT a.id FROM approvals a
      JOIN executions e ON e.id = a.execution_id
      JOIN messages m ON m.id = e.message_id
      JOIN threads t ON t.id = m.thread_id
      WHERE e.id = ? AND t.user_id = ? AND a.status = 'pending'
    `)
    .get(req.params.id, userId) as { id: string } | undefined;
  if (!approval) { res.status(404).json({ error: 'No pending approval found' }); return; }
  resolveApproval(approval.id, 'approved');
  res.json({ status: 'approved' });
});

router.post('/:id/reject', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const approval = getDb()
    .prepare(`
      SELECT a.id FROM approvals a
      JOIN executions e ON e.id = a.execution_id
      JOIN messages m ON m.id = e.message_id
      JOIN threads t ON t.id = m.thread_id
      WHERE e.id = ? AND t.user_id = ? AND a.status = 'pending'
    `)
    .get(req.params.id, userId) as { id: string } | undefined;
  if (!approval) { res.status(404).json({ error: 'No pending approval found' }); return; }
  resolveApproval(approval.id, 'rejected');
  res.json({ status: 'rejected' });
});

export default router;
