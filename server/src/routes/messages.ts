import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { runAgentTurn } from '../services/agent.js';
import { broadcast } from '../services/socket.js';

const router = Router();
router.use(requireAuth);

router.get('/:threadId/messages', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const thread = getDb()
    .prepare('SELECT id FROM threads WHERE id = ? AND user_id = ?')
    .get(req.params.threadId, userId);
  if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

  const messages = getDb()
    .prepare('SELECT id, role, content, created_at FROM messages WHERE thread_id = ? ORDER BY created_at')
    .all(req.params.threadId);
  res.json(messages);
});

router.post('/:threadId/messages', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return; }

  const thread = getDb()
    .prepare('SELECT id FROM threads WHERE id = ? AND user_id = ?')
    .get(req.params.threadId, userId);
  if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

  const messageId = newId();
  getDb()
    .prepare('INSERT INTO messages (id, thread_id, role, content) VALUES (?,?,?,?)')
    .run(messageId, req.params.threadId, 'user', content);
  getDb()
    .prepare('UPDATE threads SET updated_at = unixepoch() WHERE id = ?')
    .run(req.params.threadId);

  const userMessage = { id: messageId, role: 'user', content, created_at: Math.floor(Date.now() / 1000) };
  res.status(201).json(userMessage);

  // Trigger agent turn async — client gets reply via WebSocket
  setImmediate(async () => {
    try {
      const reply = await runAgentTurn(userId, req.params.threadId, messageId);
      if (reply) {
        const replyId = newId();
        getDb()
          .prepare('INSERT INTO messages (id, thread_id, role, content) VALUES (?,?,?,?)')
          .run(replyId, req.params.threadId, 'assistant', reply);
        getDb()
          .prepare('UPDATE threads SET updated_at = unixepoch() WHERE id = ?')
          .run(req.params.threadId);
        broadcast(userId, { type: 'message_created', message: { id: replyId, role: 'assistant', content: reply } });
      }
    } catch (err) {
      console.error('[agent turn error]', err);
    }
  });
});

export default router;
