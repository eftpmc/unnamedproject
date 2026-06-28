import { Router } from 'express';
import { unlink } from 'fs/promises';
import { getDb } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

interface MediaRow {
  id: string;
  messageId: string;
  sessionId: string;
  sessionTitle: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const rows = getDb()
    .prepare(`
      SELECT
        a.id,
        a.message_id as messageId,
        m.session_id as sessionId,
        s.title as sessionTitle,
        a.filename,
        a.mime_type as mimeType,
        a.size_bytes as sizeBytes,
        a.created_at as createdAt
      FROM message_attachments a
      JOIN messages m ON m.id = a.message_id
      JOIN sessions s ON s.id = m.session_id
      WHERE s.user_id = ?
      ORDER BY a.created_at DESC, a.filename ASC
    `)
    .all(userId) as MediaRow[];

  res.json(rows.map(row => ({
    ...row,
    url: `/sessions/${row.sessionId}/messages/${row.messageId}/attachments/${row.id}`,
  })));
});

router.delete('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { id } = req.params;

  const row = getDb()
    .prepare(`
      SELECT a.id, a.storage_path
      FROM message_attachments a
      JOIN messages m ON m.id = a.message_id
      JOIN sessions s ON s.id = m.session_id
      WHERE a.id = ? AND s.user_id = ?
    `)
    .get(id, userId) as { id: string; storage_path: string } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  getDb().prepare('DELETE FROM message_attachments WHERE id = ?').run(id);

  try {
    await unlink(row.storage_path);
  } catch {
    // File already gone — not an error
  }

  res.status(204).end();
});

export default router;
