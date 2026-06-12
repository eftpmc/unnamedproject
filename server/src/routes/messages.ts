import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { runAgentTurn } from '../services/agent.js';
import { broadcast } from '../services/socket.js';

const router = Router();
router.use(requireAuth);

router.get('/:sessionId/messages', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.sessionId, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  const messages = getDb()
    .prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at')
    .all(req.params.sessionId) as { id: string; role: string; content: string; created_at: number }[];

  const executions = getDb()
    .prepare(`
      SELECT e.id as executionId, e.message_id as messageId, e.tool, e.status, e.output_log as outputLog,
             e.result, p.name as projectName, a.id as approvalId, a.action
      FROM executions e
      LEFT JOIN projects p ON p.id = e.project_id
      LEFT JOIN approvals a ON a.execution_id = e.id AND a.status = 'pending'
      WHERE e.message_id IN (${messages.map(() => '?').join(',') || "''"})
      ORDER BY e.created_at
    `)
    .all(...messages.map(m => m.id)) as Array<{
      executionId: string; messageId: string; tool: string; status: string; outputLog: string;
      result: string | null; projectName: string | null; approvalId: string | null; action: string | null;
    }>;

  const executionsByMessage = new Map<string, typeof executions>();
  for (const e of executions) {
    const list = executionsByMessage.get(e.messageId) ?? [];
    list.push(e);
    executionsByMessage.set(e.messageId, list);
  }

  res.json(messages.map(m => ({
    ...m,
    executions: (executionsByMessage.get(m.id) ?? []).map(e => ({
      executionId: e.executionId,
      tool: e.tool,
      projectName: e.projectName ?? undefined,
      status: e.status,
      outputLog: e.outputLog,
      result: e.result,
      needsApproval: e.status === 'awaiting_approval' && !!e.approvalId,
      approvalId: e.approvalId,
      action: e.action,
    })),
  })));
});

router.post('/:sessionId/messages', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return; }

  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.sessionId, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  const messageId = newId();
  getDb()
    .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
    .run(messageId, req.params.sessionId, 'user', content);
  getDb()
    .prepare('UPDATE sessions SET updated_at = unixepoch() WHERE id = ?')
    .run(req.params.sessionId);

  const userMessage = { id: messageId, role: 'user', content, created_at: Math.floor(Date.now() / 1000) };
  res.status(201).json(userMessage);

  // Trigger agent turn async — client gets reply via WebSocket
  setImmediate(async () => {
    try {
      await runAgentTurn(userId, req.params.sessionId, messageId);
    } catch (err) {
      console.error('[agent turn error]', err);
      broadcast(userId, { type: 'agent_error', error: err instanceof Error ? err.message : String(err) });
    }
  });
});

export default router;
