import path from 'path';
import fs from 'fs/promises';
import { Router, type Request, type Response } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { writeDocument, readDocument, listDocuments, patchFrontmatter, deleteDocument } from '../services/documents.js';
import { createProject, linkProject, listProjects, getProject, deleteProject } from '../services/projects.js';
import { createTrigger, listTriggers, deleteTrigger } from '../services/triggers.js';
import { nextCronRun } from '../lib/cron.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

function spaceForUser(spaceId: string, userId: string): { id: string; name: string } | undefined {
  return getDb().prepare(
    'SELECT id, name FROM spaces WHERE id = ? AND user_id = ?',
  ).get(spaceId, userId) as { id: string; name: string } | undefined;
}

router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const rows = getDb().prepare(`
    SELECT id, name, description, enabled_connection_ids, created_at
    FROM spaces
    WHERE user_id = ?
    ORDER BY name
  `).all(userId) as Array<Record<string, unknown> & { enabled_connection_ids: string }>;
  res.json(rows.map(row => ({
    ...row,
    enabled_connection_ids: JSON.parse(row.enabled_connection_ids),
  })));
});

router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb().prepare(`
    SELECT id, name, description, enabled_connection_ids, created_at
    FROM spaces
    WHERE id = ? AND user_id = ?
  `).get(req.params.id, userId) as (Record<string, unknown> & { enabled_connection_ids: string }) | undefined;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ...row, enabled_connection_ids: JSON.parse(row.enabled_connection_ids) });
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { name, description, enabled_connection_ids = [] } = req.body as {
    name?: string;
    description?: string;
    enabled_connection_ids?: string[];
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name required' });
    return;
  }
  const id = newId();
  try {
    getDb().prepare(`
      INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, name.trim(), description ?? null, JSON.stringify(enabled_connection_ids));
  } catch {
    res.status(409).json({ error: 'Space name already exists' });
    return;
  }
  res.status(201).json({ id, name: name.trim() });
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  if (!spaceForUser(req.params.id, userId)) {
    res.status(404).json({ error: 'Space not found' });
    return;
  }
  const { description, name, enabled_connection_ids } = req.body as {
    description?: string | null;
    name?: string;
    enabled_connection_ids?: string[];
  };
  const fields: string[] = [];
  const values: unknown[] = [];
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (name?.trim()) { fields.push('name = ?'); values.push(name.trim()); }
  if (enabled_connection_ids !== undefined) {
    fields.push('enabled_connection_ids = ?');
    values.push(JSON.stringify(enabled_connection_ids));
  }
  if (fields.length > 0) {
    values.push(req.params.id, userId);
    getDb().prepare(
      `UPDATE spaces SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    ).run(...values);
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const result = getDb().prepare('DELETE FROM spaces WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Space not found' });
    return;
  }
  res.status(204).end();
});

// Guard: verifies the caller owns the space identified by :spaceId.
// Returns true if the space exists; sends 404 and returns false otherwise.
function requireSpace(req: Request, res: Response): boolean {
  const { userId } = req as unknown as AuthedRequest;
  const space = spaceForUser(req.params.spaceId, userId);
  if (!space) { res.status(404).json({ error: 'Space not found' }); return false; }
  return true;
}

// Path-escape guard for project file browser. Resolves relPath inside repoPath
// and throws if the result would escape the repo root.
function resolveInRepo(repoPath: string, relPath: string): string {
  const root = path.resolve(repoPath);
  const resolved = path.resolve(root, relPath || '.');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes repository root');
  }
  return resolved;
}

// ─── Documents ───────────────────────────────────────────────────────────────

router.get('/:spaceId/documents', (req, res) => {
  if (!requireSpace(req, res)) return;
  const { type, ...rest } = req.query as Record<string, string>;
  const frontmatter = Object.keys(rest).length ? rest : undefined;
  res.json(listDocuments(req.params.spaceId, (type || frontmatter) ? { type, frontmatter } : undefined));
});

router.post('/:spaceId/documents', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const { path: docPath, title, frontmatter, body } = req.body as {
    path?: string; title?: string; frontmatter?: Record<string, unknown>; body?: string;
  };
  if (!docPath?.trim() || !title?.trim() || body === undefined) {
    res.status(400).json({ error: 'path, title, body required' });
    return;
  }
  res.status(201).json(await writeDocument({
    space_id: req.params.spaceId,
    path: docPath.trim(),
    title: title.trim(),
    frontmatter,
    body,
  }));
});

router.get('/:spaceId/documents/:docId', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const doc = await readDocument(req.params.docId);
  if (!doc || doc.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Document not found' }); return; }
  res.json(doc);
});

router.patch('/:spaceId/documents/:docId', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const doc = await readDocument(req.params.docId);
  if (!doc || doc.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Document not found' }); return; }
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

router.delete('/:spaceId/documents/:docId', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const doc = await readDocument(req.params.docId);
  if (!doc || doc.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Document not found' }); return; }
  await deleteDocument(doc.id);
  res.status(204).end();
});

// ─── Projects ────────────────────────────────────────────────────────────────

router.get('/:spaceId/projects', (req, res) => {
  if (!requireSpace(req, res)) return;
  res.json(listProjects(req.params.spaceId));
});

router.post('/:spaceId/projects', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const { name, repo_path, default_branch } = req.body as {
    name?: string; repo_path?: string; default_branch?: string | null;
  };
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }
  const project = repo_path
    ? linkProject({ space_id: req.params.spaceId, name: name.trim(), repo_path, default_branch })
    : await createProject({ space_id: req.params.spaceId, name: name.trim() });
  res.status(201).json(project);
});

router.delete('/:spaceId/projects/:projectId', (req, res) => {
  if (!requireSpace(req, res)) return;
  const project = getProject(req.params.projectId);
  if (!project || project.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  deleteProject(project.id);
  res.status(204).end();
});

router.get('/:spaceId/projects/:projectId/tree', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const project = getProject(req.params.projectId);
  if (!project || project.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const relPath = (req.query.path as string | undefined) ?? '';
  let dir: string;
  try { dir = resolveInRepo(project.repo_path, relPath); } catch {
    res.status(400).json({ error: 'Invalid path' }); return;
  }
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const prefix = relPath ? `${relPath}/` : '';
    res.json({ entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', path: `${prefix}${e.name}` })) });
  } catch {
    res.status(404).json({ error: 'Path not found' });
  }
});

router.get('/:spaceId/projects/:projectId/file', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const project = getProject(req.params.projectId);
  if (!project || project.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const relPath = (req.query.path as string | undefined) ?? '';
  let filePath: string;
  try { filePath = resolveInRepo(project.repo_path, relPath); } catch {
    res.status(400).json({ error: 'Invalid path' }); return;
  }
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ path: relPath, content });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// ─── Triggers ────────────────────────────────────────────────────────────────

router.get('/:spaceId/triggers', (req, res) => {
  if (!requireSpace(req, res)) return;
  res.json(listTriggers(req.params.spaceId));
});

router.post('/:spaceId/triggers', (req, res) => {
  if (!requireSpace(req, res)) return;
  const { kind, schedule_cron, playbook_id } = req.body as {
    kind?: 'schedule' | 'webhook' | 'manual';
    schedule_cron?: string | null;
    playbook_id?: string | null;
  };
  if (!kind || !['schedule', 'webhook', 'manual'].includes(kind)) {
    res.status(400).json({ error: 'kind required (schedule|webhook|manual)' });
    return;
  }
  let next_run_at: number | null = null;
  if (kind === 'schedule' && schedule_cron) {
    try {
      next_run_at = nextCronRun(schedule_cron, Math.floor(Date.now() / 1000));
    } catch {
      res.status(400).json({ error: 'invalid schedule_cron expression' });
      return;
    }
  }
  res.status(201).json(createTrigger({
    space_id: req.params.spaceId,
    kind,
    schedule_cron: schedule_cron ?? null,
    playbook_id: playbook_id ?? null,
    next_run_at,
  }));
});

router.delete('/:spaceId/triggers/:triggerId', (req, res) => {
  if (!requireSpace(req, res)) return;
  const triggers = listTriggers(req.params.spaceId);
  const trigger = triggers.find(t => t.id === req.params.triggerId);
  if (!trigger) { res.status(404).json({ error: 'Trigger not found' }); return; }
  deleteTrigger(trigger.id);
  res.status(204).end();
});

export default router;
