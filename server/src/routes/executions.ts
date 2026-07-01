import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { resolveApproval } from '../lib/approval.js';
import { killProcess } from '../lib/process-registry.js';
import { completeExecution } from '../services/executor.js';

const router = Router();
router.use(requireAuth);

router.get('/pending-approvals', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const rows = getDb()
    .prepare(`
      SELECT a.id as approval_id, a.execution_id, a.action, a.payload,
             e.tool, e.created_at, m.session_id
      FROM approvals a
      JOIN executions e ON e.id = a.execution_id
      LEFT JOIN messages m ON m.id = e.message_id
      LEFT JOIN sessions t ON t.id = m.session_id
      WHERE (t.user_id = ? OR e.message_id IS NULL) AND a.status = 'pending'
    `)
    .all(userId) as Array<{ approval_id: string; execution_id: string; action: string; payload: string; tool: string; created_at: number; session_id: string | null }>;
  res.json(rows.map(r => ({ ...r, payload: JSON.parse(r.payload) })));
});

router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const execution = getDb()
    .prepare(`
      SELECT e.id, e.tool, e.status, e.output_log, e.result, e.created_at, e.completed_at,
             e.project_id, a.id as approval_id, a.action, a.payload
      FROM executions e
      LEFT JOIN approvals a ON a.execution_id = e.id AND a.status = 'pending'
      LEFT JOIN messages m ON m.id = e.message_id
      LEFT JOIN sessions t ON t.id = m.session_id
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
      LEFT JOIN messages m ON m.id = e.message_id
      LEFT JOIN sessions t ON t.id = m.session_id
      WHERE e.id = ? AND (t.user_id = ? OR e.message_id IS NULL) AND a.status = 'pending'
    `)
    .get(req.params.id, userId) as { id: string } | undefined;
  if (!approval) { res.status(404).json({ error: 'No pending approval found' }); return; }
  const { value } = req.body as { value?: string };
  getDb()
    .prepare("UPDATE approvals SET status = 'approved', value = ?, resolved_at = unixepoch() WHERE id = ?")
    .run(value ?? null, approval.id);
  getDb()
    .prepare("UPDATE executions SET status = 'running' WHERE id = ? AND status = 'awaiting_approval'")
    .run(req.params.id);
  resolveApproval(approval.id, 'approved', value);
  res.json({ status: 'approved' });
});

router.post('/:id/reject', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const approval = getDb()
    .prepare(`
      SELECT a.id FROM approvals a
      JOIN executions e ON e.id = a.execution_id
      LEFT JOIN messages m ON m.id = e.message_id
      LEFT JOIN sessions t ON t.id = m.session_id
      WHERE e.id = ? AND (t.user_id = ? OR e.message_id IS NULL) AND a.status = 'pending'
    `)
    .get(req.params.id, userId) as { id: string } | undefined;
  if (!approval) { res.status(404).json({ error: 'No pending approval found' }); return; }
  getDb()
    .prepare("UPDATE approvals SET status = 'rejected', resolved_at = unixepoch() WHERE id = ?")
    .run(approval.id);
  getDb()
    .prepare("UPDATE executions SET status = 'running' WHERE id = ? AND status = 'awaiting_approval'")
    .run(req.params.id);
  resolveApproval(approval.id, 'rejected');
  res.json({ status: 'rejected' });
});

router.post('/:id/cancel', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const execution = getDb()
    .prepare(`
      SELECT e.id FROM executions e
      JOIN messages m ON m.id = e.message_id
      JOIN sessions t ON t.id = m.session_id
      WHERE e.id = ? AND t.user_id = ? AND e.status IN ('pending','running')
    `)
    .get(req.params.id, userId) as { id: string } | undefined;
  if (!execution) { res.status(404).json({ error: 'No active execution found' }); return; }
  killProcess(req.params.id);
  completeExecution(req.params.id, userId, 'error', 'Cancelled');
  res.json({ ok: true });
});

export default router;
