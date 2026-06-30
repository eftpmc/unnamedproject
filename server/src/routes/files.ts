import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getDb } from '../db/index.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { writeFile, writeBinaryFile, readFile, tagFile, deleteFile } from '../services/files.js';
import { resolveInFiles } from '../lib/spaceFs.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 50 * 1024 * 1024 },
});

function projectOwnsFile(projectId: string, userId: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w.-]/g, '') || 'file';
}

function uniquePath(projectId: string, base: string): string {
  let p = base;
  let counter = 2;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  while (getDb().prepare('SELECT id FROM files WHERE project_id = ? AND path = ?').get(projectId, p)) {
    p = `${stem}-${counter}${ext}`;
    counter++;
  }
  return p;
}

// Create a new text file (JSON body) or binary upload (multipart)
router.post('/', upload.single('file'), async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;

  // Multipart binary upload
  if (req.file) {
    const { project_id, title } = req.body as { project_id?: string; title?: string };
    if (!project_id) { res.status(400).json({ error: 'project_id is required' }); return; }

    if (!projectOwnsFile(project_id, userId)) { res.status(404).json({ error: 'Project not found' }); return; }

    const filename = req.file.originalname || 'upload';
    const fileTitle = title?.trim() || path.basename(filename, path.extname(filename));
    const filePath = uniquePath(project_id, slugify(filename));

    const file = await writeBinaryFile({
      project_id,
      path: filePath,
      title: fileTitle,
      mime_type: req.file.mimetype,
      data: req.file.buffer,
    });
    res.status(201).json(file);
    return;
  }

  // JSON text file creation
  const { title, body = '', tags, project_id } = req.body as {
    title?: string;
    body?: string;
    tags?: Record<string, unknown>;
    project_id?: string;
  };

  if (!title || !project_id) {
    res.status(400).json({ error: 'title and project_id are required' });
    return;
  }

  if (!projectOwnsFile(project_id, userId)) { res.status(404).json({ error: 'Project not found' }); return; }

  const filePath = uniquePath(project_id, `${slugify(title)}.md`);
  const file = await writeFile({ project_id, path: filePath, title, tags, body });
  res.status(201).json(file);
});

// List all files for this user across all their projects
router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { type, mime } = req.query as Record<string, string>;
  let sql = `SELECT f.* FROM files f JOIN projects p ON p.id = f.project_id WHERE p.user_id = ?`;
  const params: unknown[] = [userId];
  if (type) { sql += ' AND f.type = ?'; params.push(type); }
  if (mime) { sql += ' AND f.mime_type LIKE ?'; params.push(`${mime}%`); }
  sql += ' ORDER BY f.updated_at DESC';
  const rows = getDb().prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json(rows.map(row => ({
    ...row,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags as string) : row.tags,
  })));
});

router.get('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const file = await readFile(req.params.id);
  if (!file) { res.status(404).json({ error: 'File not found' }); return; }
  if (!projectOwnsFile(file.project_id, userId)) { res.status(404).json({ error: 'File not found' }); return; }
  res.json(file);
});

// Serve raw file content (for binary files like PDFs and images)
router.get('/:id/content', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb().prepare('SELECT * FROM files WHERE id = ?').get(req.params.id) as
    { id: string; project_id: string; path: string; title: string; mime_type: string } | undefined;
  if (!row) { res.status(404).json({ error: 'File not found' }); return; }
  if (!projectOwnsFile(row.project_id, userId)) { res.status(404).json({ error: 'File not found' }); return; }

  const project = getDb().prepare('SELECT files_path FROM projects WHERE id = ?').get(row.project_id) as { files_path: string } | undefined;
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const filePath = resolveInFiles(project.files_path, row.path);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found on disk' }); return; }

  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.title)}${path.extname(row.path)}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.patch('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const file = await readFile(req.params.id);
  if (!file) { res.status(404).json({ error: 'File not found' }); return; }
  if (!projectOwnsFile(file.project_id, userId)) { res.status(404).json({ error: 'File not found' }); return; }
  const { tags, title, body } = req.body as {
    tags?: Record<string, unknown>; title?: string; body?: string;
  };
  if (title === undefined && body === undefined && tags) {
    res.json(await tagFile(file.id, tags));
    return;
  }
  if (file.body === null) {
    if (tags) await tagFile(file.id, tags);
    if (title) {
      const now = Math.floor(Date.now() / 1000);
      getDb().prepare('UPDATE files SET title=?, updated_at=? WHERE id=?').run(title, now, file.id);
    }
    res.json(await readFile(file.id));
    return;
  }
  res.json(await writeFile({
    project_id: file.project_id,
    path: file.path,
    title: title ?? file.title,
    tags: { ...file.tags, ...(tags ?? {}) },
    body: body ?? file.body,
  }));
});

router.delete('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const file = await readFile(req.params.id);
  if (!file) { res.status(404).json({ error: 'File not found' }); return; }
  if (!projectOwnsFile(file.project_id, userId)) { res.status(404).json({ error: 'File not found' }); return; }
  await deleteFile(file.id);
  res.status(204).end();
});

export default router;
