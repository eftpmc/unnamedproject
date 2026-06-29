import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { writeDocument, readDocument, patchFrontmatter, deleteDocument } from '../services/documents.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

function projectOwnsDoc(spaceId: string, userId: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM projects WHERE space_id = ? AND user_id = ?').get(spaceId, userId);
}

// Create a new document
router.post('/', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { title, body = '', frontmatter, project_id, space_id } = req.body as {
    title?: string;
    body?: string;
    frontmatter?: Record<string, unknown>;
    project_id?: string;
    space_id?: string; // legacy alias
  };

  if (!title || (!project_id && !space_id)) {
    res.status(400).json({ error: 'title and project_id are required' });
    return;
  }

  // Resolve the internal space_id from project_id
  let resolvedSpaceId: string;
  if (project_id) {
    const project = getDb().prepare('SELECT space_id FROM projects WHERE id = ? AND user_id = ?').get(project_id, userId) as { space_id: string } | undefined;
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    resolvedSpaceId = project.space_id;
  } else {
    // Legacy: space_id passed directly — verify ownership via projects table
    if (!projectOwnsDoc(space_id!, userId)) { res.status(404).json({ error: 'Project not found' }); return; }
    resolvedSpaceId = space_id!;
  }

  const base = `${title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || 'document'}.md`;
  let docPath = base;
  let counter = 2;
  while (getDb().prepare('SELECT id FROM documents WHERE space_id = ? AND path = ?').get(resolvedSpaceId, docPath)) {
    docPath = base.replace('.md', `-${counter}.md`);
    counter++;
  }

  const doc = await writeDocument({ space_id: resolvedSpaceId, path: docPath, title, frontmatter, body });
  res.status(201).json(doc);
});

// List all documents for this user across all their projects
router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { type } = req.query as Record<string, string>;
  const rows = getDb().prepare(`
    SELECT d.*
    FROM documents d
    JOIN projects p ON p.space_id = d.space_id
    WHERE p.user_id = ?
    ${type ? 'AND d.type = ?' : ''}
    ORDER BY d.updated_at DESC
  `).all(...(type ? [userId, type] : [userId])) as Array<Record<string, unknown>>;
  res.json(rows.map(row => ({
    ...row,
    frontmatter: typeof row.frontmatter === 'string' ? JSON.parse(row.frontmatter as string) : row.frontmatter,
  })));
});

router.get('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const doc = await readDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  if (!projectOwnsDoc(doc.space_id, userId)) { res.status(404).json({ error: 'Document not found' }); return; }
  res.json(doc);
});

router.patch('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const doc = await readDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  if (!projectOwnsDoc(doc.space_id, userId)) { res.status(404).json({ error: 'Document not found' }); return; }
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

router.delete('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const doc = await readDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  if (!projectOwnsDoc(doc.space_id, userId)) { res.status(404).json({ error: 'Document not found' }); return; }
  await deleteDocument(doc.id);
  res.status(204).end();
});

export default router;
