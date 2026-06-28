import { Router } from 'express';
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

export default router;
