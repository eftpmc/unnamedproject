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
    .all(req.params.sessionId);
  res.json(messages);
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
      const reply = await runAgentTurn(userId, req.params.sessionId, messageId);
      if (reply) {
        const replyId = newId();
        getDb()
          .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
          .run(replyId, req.params.sessionId, 'assistant', reply);
        getDb()
          .prepare('UPDATE sessions SET updated_at = unixepoch() WHERE id = ?')
          .run(req.params.sessionId);
        broadcast(userId, { type: 'message_created', message: { id: replyId, role: 'assistant', content: reply } });
      }
    } catch (err) {
      console.error('[agent turn error]', err);
    }
  });
});

export default router;
