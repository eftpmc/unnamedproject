import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getDb } from '../db/index.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { writeDocument, writeBinaryDocument, readDocument, patchFrontmatter, deleteDocument } from '../services/documents.js';
import { resolveInDocuments } from '../lib/spaceFs.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 50 * 1024 * 1024 },
});

function projectOwnsDoc(spaceId: string, userId: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM projects WHERE space_id = ? AND user_id = ?').get(spaceId, userId);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w.-]/g, '') || 'file';
}

function uniquePath(spaceId: string, base: string): string {
  let p = base;
  let counter = 2;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  while (getDb().prepare('SELECT id FROM documents WHERE space_id = ? AND path = ?').get(spaceId, p)) {
    p = `${stem}-${counter}${ext}`;
    counter++;
  }
  return p;
}

// Create a new text document (JSON body)
router.post('/', upload.single('file'), async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;

  // Multipart binary upload
  if (req.file) {
    const { project_id, title } = req.body as { project_id?: string; title?: string };
    if (!project_id) { res.status(400).json({ error: 'project_id is required' }); return; }

    const project = getDb().prepare('SELECT space_id FROM projects WHERE id = ? AND user_id = ?').get(project_id, userId) as { space_id: string } | undefined;
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const filename = req.file.originalname || 'upload';
    const docTitle = title?.trim() || path.basename(filename, path.extname(filename));
    const docPath = uniquePath(project.space_id, slugify(filename));

    const doc = await writeBinaryDocument({
      space_id: project.space_id,
      path: docPath,
      title: docTitle,
      mime_type: req.file.mimetype,
      data: req.file.buffer,
    });
    res.status(201).json(doc);
    return;
  }

  // JSON text document creation
  const { title, body = '', frontmatter, project_id, space_id } = req.body as {
    title?: string;
    body?: string;
    frontmatter?: Record<string, unknown>;
    project_id?: string;
    space_id?: string;
  };

  if (!title || (!project_id && !space_id)) {
    res.status(400).json({ error: 'title and project_id are required' });
    return;
  }

  let resolvedSpaceId: string;
  if (project_id) {
    const project = getDb().prepare('SELECT space_id FROM projects WHERE id = ? AND user_id = ?').get(project_id, userId) as { space_id: string } | undefined;
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    resolvedSpaceId = project.space_id;
  } else {
    if (!projectOwnsDoc(space_id!, userId)) { res.status(404).json({ error: 'Project not found' }); return; }
    resolvedSpaceId = space_id!;
  }

  const docPath = uniquePath(resolvedSpaceId, `${slugify(title)}.md`);
  const doc = await writeDocument({ space_id: resolvedSpaceId, path: docPath, title, frontmatter, body });
  res.status(201).json(doc);
});

// List all documents for this user across all their projects
router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { type, mime } = req.query as Record<string, string>;
  let sql = `SELECT d.* FROM documents d JOIN projects p ON p.space_id = d.space_id WHERE p.user_id = ?`;
  const params: unknown[] = [userId];
  if (type) { sql += ' AND d.type = ?'; params.push(type); }
  if (mime) { sql += ' AND d.mime_type LIKE ?'; params.push(`${mime}%`); }
  sql += ' ORDER BY d.updated_at DESC';
  const rows = getDb().prepare(sql).all(...params) as Array<Record<string, unknown>>;
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

// Serve raw file content (for binary files like PDFs and images)
router.get('/:id/content', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id) as
    { id: string; space_id: string; path: string; title: string; mime_type: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Document not found' }); return; }
  if (!projectOwnsDoc(row.space_id, userId)) { res.status(404).json({ error: 'Document not found' }); return; }

  const filePath = resolveInDocuments(row.space_id, row.path);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found on disk' }); return; }

  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.title)}${path.extname(row.path)}"`);
  fs.createReadStream(filePath).pipe(res);
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
  if (doc.body === null) {
    // Binary doc — only title and frontmatter patchable
    if (frontmatter) await patchFrontmatter(doc.id, frontmatter);
    if (title) {
      const now = Math.floor(Date.now() / 1000);
      getDb().prepare('UPDATE documents SET title=?, updated_at=? WHERE id=?').run(title, now, doc.id);
    }
    res.json(await readDocument(doc.id));
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
