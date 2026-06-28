import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { writeDocument, readDocument, patchFrontmatter, deleteDocument } from '../services/documents.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

// List all documents for this user across all their spaces
router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { type } = req.query as Record<string, string>;
  const rows = getDb().prepare(`
    SELECT d.*
    FROM documents d
    JOIN spaces s ON d.space_id = s.id
    WHERE s.user_id = ?
    ${type ? 'AND d.type = ?' : ''}
    ORDER BY d.updated_at DESC
  `).all(...(type ? [userId, type] : [userId])) as Array<Record<string, unknown>>;
  res.json(rows.map(row => ({
    ...row,
    frontmatter: typeof row.frontmatter === 'string' ? JSON.parse(row.frontmatter as string) : row.frontmatter,
  })));
});

// Get a single document (auth: must be owned by user's space)
router.get('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const doc = await readDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  // Verify ownership
  const space = getDb().prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?').get(doc.space_id, userId);
  if (!space) { res.status(404).json({ error: 'Document not found' }); return; }
  res.json(doc);
});

// Update document
router.patch('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const doc = await readDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const space = getDb().prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?').get(doc.space_id, userId);
  if (!space) { res.status(404).json({ error: 'Document not found' }); return; }
  const { frontmatter, title, body } = req.body as {
    frontmatter?: Record<string, unknown>; title?: string; body?: string;
  };
  if (title === undefined && body === undefined && frontmatter) {
    res.json(await patchFrontmatter(doc.id, frontmatter));
    return;
  }
  res.json(await writeDocument({
    space_id: doc.space_id,
    path: doc.path,
    title: title ?? doc.title,
    frontmatter: { ...doc.frontmatter, ...(frontmatter ?? {}) },
    body: body ?? doc.body,
  }));
});

// Delete document
router.delete('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const doc = await readDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const space = getDb().prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?').get(doc.space_id, userId);
  if (!space) { res.status(404).json({ error: 'Document not found' }); return; }
  await deleteDocument(doc.id);
  res.status(204).end();
});

export default router;
