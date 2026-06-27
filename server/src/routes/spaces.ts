import { Router, type Request, type Response } from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import multer from 'multer';
import { getDataDir, getDb, getSessionsForItem } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import {
  createItem,
  deleteItem,
  getItemById,
  getItemsForSpace,
  updateItemPageBlocks,
  updateItemPageBlock,
  updateTaskDone,
  type Block,
  type SpaceItemBase,
} from '../services/items.js';
import { listItemTypes, getItemType, createItemTemplate, updateItemTemplate, deleteItemTemplate } from '../services/templates.js';
import { validateBlock, validateBlocks } from '../lib/blocks.js';
import { detectCapabilities } from '../services/projectCapabilities.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 50 * 1024 * 1024 },
});

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function spaceForUser(spaceId: string, userId: string): { id: string; name: string } | undefined {
  return getDb().prepare(
    'SELECT id, name FROM spaces WHERE id = ? AND user_id = ?',
  ).get(spaceId, userId) as { id: string; name: string } | undefined;
}

function requireSpace(req: Request, res: Response): { id: string; name: string } | undefined {
  const { userId } = req as unknown as AuthedRequest;
  const space = spaceForUser(req.params.spaceId ?? req.params.id, userId);
  if (!space) res.status(404).json({ error: 'Space not found' });
  return space;
}

function requireRepoItem(
  req: Request,
  res: Response,
): SpaceItemBase | undefined {
  if (!requireSpace(req, res)) return undefined;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Item not found in this space' });
    return undefined;
  }
  if (item.type !== 'repo') {
    res.status(400).json({ error: `Operation not supported for item type '${item.type}'` });
    return undefined;
  }
  return item;
}

function resolveInItem(base: string, relativePath: string): string {
  const resolved = path.resolve(base, relativePath || '.');
  const root = path.resolve(base);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes item root');
  }
  return resolved;
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

router.get('/:spaceId/items', (req, res) => {
  if (!requireSpace(req, res)) return;
  const before = req.query.before ? parseInt(req.query.before as string, 10) : undefined;
  const PAGE = 100;
  res.json(getItemsForSpace(req.params.spaceId, undefined, { limit: PAGE, before }));
});

router.get('/item-templates', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  res.json(listItemTypes(userId));
});

router.post('/item-templates', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { name, blocks } = req.body as { name?: string; blocks?: unknown[] };
  if (!name?.trim() || !Array.isArray(blocks)) {
    res.status(400).json({ error: 'name and blocks required' });
    return;
  }
  const blocksError = validateBlocks(blocks);
  if (blocksError) {
    res.status(400).json({ error: blocksError });
    return;
  }
  res.status(201).json(createItemTemplate(userId, name.trim(), blocks as Block[]));
});

router.patch('/item-templates/:templateId', (req, res) => {
  const { name, blocks } = req.body as { name?: string; blocks?: unknown[] };
  if (!Array.isArray(blocks)) {
    res.status(400).json({ error: 'blocks required' });
    return;
  }
  const blocksError = validateBlocks(blocks);
  if (blocksError) {
    res.status(400).json({ error: blocksError });
    return;
  }
  const updated = updateItemTemplate(req.params.templateId, blocks as Block[], name?.trim());
  if (!updated) {
    res.status(404).json({ error: 'Template not found or not editable' });
    return;
  }
  res.json(updated);
});

router.delete('/item-templates/:templateId', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const template = getItemType(req.params.templateId);
  if (!template || template.is_builtin) {
    res.status(404).json({ error: 'Template not found or not deletable' });
    return;
  }
  if (template.user_id !== userId) {
    res.status(403).json({ error: 'Not allowed' });
    return;
  }
  deleteItemTemplate(req.params.templateId);
  res.status(204).end();
});

router.post('/:spaceId/items', (req, res) => {
  if (!requireSpace(req, res)) return;
  const { type, name } = req.body as { type?: string; name?: string };
  if (!name?.trim() || !type?.trim()) {
    res.status(400).json({ error: 'type and name required' });
    return;
  }

  const itemType = getItemType(type);
  if (!itemType) {
    res.status(404).json({ error: `Unknown item type '${type}'` });
    return;
  }
  const fields: Record<string, unknown> = req.body.fields ?? {};
  if (type === 'repo') {
    if (!req.body.repo_path && !fields.repo_path) {
      res.status(400).json({ error: 'repo_path required' });
      return;
    }
    if (req.body.repo_path) { fields.repo_path = req.body.repo_path; fields.default_branch = req.body.default_branch ?? null; }
  }
  if (type === 'file') {
    if (!req.body.file_path && !fields.file_path) {
      res.status(400).json({ error: 'file_path required' });
      return;
    }
    if (req.body.file_path) { fields.file_path = req.body.file_path; fields.size_bytes = req.body.size_bytes ?? null; fields.mime_type = req.body.mime_type ?? null; }
  }
  res.status(201).json(createItem({
    space_id: req.params.spaceId,
    name: name.trim(),
    type,
    page_blocks: itemType.blocks ?? [],
    fields,
  }));
});

router.delete('/:spaceId/items/:itemId', (req, res) => {
  if (!requireSpace(req, res)) return;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Item not found in this space' });
    return;
  }
  deleteItem(item.id);
  res.status(204).end();
});

router.get('/:spaceId/items/:itemId', (req, res) => {
  if (!requireSpace(req, res)) return;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Item not found in this space' });
    return;
  }
  res.json(item);
});

router.get('/:spaceId/items/:itemId/sessions', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  if (!requireSpace(req, res)) return;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Item not found' }); return; }
  res.json(getSessionsForItem(item.id, userId));
});

router.patch('/:spaceId/items/:itemId', (req, res) => {
  if (!requireSpace(req, res)) return;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Item not found in this space' });
    return;
  }
  const { name, content, page_blocks, block_id, block } = req.body as {
    name?: string;
    content?: string;
    page_blocks?: unknown[];
    block_id?: string;
    block?: unknown;
  };
  if (name !== undefined) {
    if (!name.trim()) {
      res.status(400).json({ error: 'name cannot be empty' });
      return;
    }
    getDb().prepare('UPDATE space_items SET name = ? WHERE id = ?').run(name.trim(), item.id);
  }
  if (content !== undefined) {
    res.status(400).json({ error: `Content editing is not supported` });
    return;
  }
  if (page_blocks !== undefined) {
    if (!Array.isArray(page_blocks)) {
      res.status(400).json({ error: 'page_blocks must be an array' });
      return;
    }
    const blocksError = validateBlocks(page_blocks);
    if (blocksError) {
      res.status(400).json({ error: blocksError });
      return;
    }
    updateItemPageBlocks(item.id, page_blocks as Block[]);
  }
  if (block_id !== undefined) {
    const blockError = validateBlock(block, 'block');
    if (blockError) {
      res.status(400).json({ error: blockError });
      return;
    }
    if (!updateItemPageBlock(item.id, block_id, block as Block)) {
      res.status(404).json({ error: `No block with id '${block_id}' on this item — it may predate having an id, use page_blocks (full replace) instead` });
      return;
    }
  }
  res.json(getItemById(item.id));
});

router.patch('/:spaceId/items/:itemId/tasks/:taskId', (req, res) => {
  if (!requireSpace(req, res)) return;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Item not found in this space' });
    return;
  }
  if (item.type === 'repo' || item.type === 'file') {
    res.status(400).json({ error: 'Task updates only supported on template items' });
    return;
  }
  const { done } = req.body as { done?: boolean };
  if (typeof done !== 'boolean') {
    res.status(400).json({ error: 'done (boolean) required' });
    return;
  }
  const found = updateTaskDone(item.id, req.params.taskId, done);
  if (!found) {
    res.status(404).json({ error: `Task ${req.params.taskId} not found` });
    return;
  }
  res.json(getItemById(item.id));
});

router.get('/:spaceId/items/:itemId/content', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Item not found in this space' });
    return;
  }
  if (item.type === 'repo') {
    res.status(400).json({ error: "Operation not supported for item type 'repo'" });
    return;
  }
  try {
    const filePath = item.fields.file_path as string | undefined;
    if (!filePath) { res.status(400).json({ error: 'Item has no file content' }); return; }
    const content = await fs.readFile(filePath);
    res.type((item.fields.mime_type as string | undefined) ?? 'application/octet-stream').send(content);
  } catch {
    res.status(404).json({ error: 'Item content not found' });
  }
});


router.get('/:spaceId/items/:itemId/tree', async (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  try {
    const target = resolveInItem(item.fields.repo_path as string, (req.query.path as string) || '');
    const entries = await fs.readdir(target, { withFileTypes: true });
    res.json({
      entries: entries
        .filter(entry => !entry.name.startsWith('.'))
        .map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
          path: path.relative(item.fields.repo_path as string, path.join(target, entry.name)),
        }))
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1),
      base_is_repo: true,
    });
  } catch {
    res.json({ entries: [], base_is_repo: true });
  }
});

router.get('/:spaceId/items/:itemId/file', async (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  const relativePath = (req.query.path as string) || '';
  if (!relativePath) {
    res.status(400).json({ error: 'path required' });
    return;
  }
  try {
    res.json({ content: await fs.readFile(resolveInItem(item.fields.repo_path as string, relativePath), 'utf-8'), path: relativePath });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

router.get('/:spaceId/items/:itemId/capabilities', (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  res.json(detectCapabilities(item.id, item.fields.repo_path as string));
});

router.get('/:spaceId/items/:itemId/workspace', async (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  try {
    res.json({ content: await fs.readFile(path.join(item.fields.repo_path as string, 'workspace.md'), 'utf-8') });
  } catch {
    res.json({ content: '' });
  }
});

router.put('/:spaceId/items/:itemId/workspace', async (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  await fs.writeFile(path.join(item.fields.repo_path as string, 'workspace.md'), req.body.content ?? '', 'utf-8');
  res.json({ ok: true });
});

function itemContentDir(spaceId: string, itemId: string, kind: 'media' | 'research'): string {
  return path.join(getDataDir(), 'spaces', spaceId, 'items', itemId, kind);
}

router.get('/:spaceId/items/:itemId/media', (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  const dir = itemContentDir(req.params.spaceId, item.id, 'media');
  if (!fsSync.existsSync(dir)) {
    res.json({ files: [] });
    return;
  }
  res.json({
    files: fsSync.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => {
        const stat = fsSync.statSync(path.join(dir, entry.name));
        return {
          name: entry.name,
          url: `/spaces/${req.params.spaceId}/items/${item.id}/media/${encodeURIComponent(entry.name)}`,
          createdAt: stat.birthtimeMs,
        };
      }),
  });
});

router.get('/:spaceId/items/:itemId/media/:filename', (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  const { filename } = req.params;
  if (filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  const filePath = path.join(itemContentDir(req.params.spaceId, item.id, 'media'), filename);
  if (!fsSync.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.type(MEDIA_CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream');
  fsSync.createReadStream(filePath).pipe(res);
});

router.get('/:spaceId/items/:itemId/research', (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  const dir = itemContentDir(req.params.spaceId, item.id, 'research');
  if (!fsSync.existsSync(dir)) {
    res.json({ files: [] });
    return;
  }
  res.json({
    files: fsSync.readdirSync(dir)
      .filter(filename => filename.endsWith('.md'))
      .map(name => {
        const stat = fsSync.statSync(path.join(dir, name));
        return { name, title: name.replace(/\.md$/, '').replace(/[-_]/g, ' '), createdAt: stat.birthtimeMs || stat.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt),
  });
});

router.get('/:spaceId/items/:itemId/research/:filename', (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  const { filename } = req.params;
  if (filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  const filePath = path.join(itemContentDir(req.params.spaceId, item.id, 'research'), path.basename(filename));
  if (!fsSync.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.type('text/plain').send(fsSync.readFileSync(filePath, 'utf-8'));
});

// ── Item file storage ─────────────────────────────────────────────────────────

function getItemFiles(itemId: string) {
  return getDb()
    .prepare('SELECT id, filename, mime_type as mimeType, size_bytes as sizeBytes, created_at as createdAt FROM item_files WHERE item_id = ? ORDER BY created_at')
    .all(itemId) as { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: number }[];
}

function serializeItemFile(spaceId: string, itemId: string, f: { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: number }) {
  return { ...f, url: `/spaces/${spaceId}/items/${itemId}/files/${f.id}` };
}

router.get('/:spaceId/items/:itemId/files', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Item not found' }); return; }
  void userId;
  res.json(getItemFiles(item.id).map(f => serializeItemFile(req.params.spaceId, item.id, f)));
});

router.post('/:spaceId/items/:itemId/files', fileUpload.single('file'), (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Item not found' }); return; }
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'file required' }); return; }

  const fileId = newId();
  const filename = path.basename(file.originalname).replace(/[^\w.\- ()[\]]+/g, '_').trim() || 'file';
  const dir = path.join(getDataDir(), 'item-files', userId, req.params.spaceId, item.id);
  fsSync.mkdirSync(dir, { recursive: true });
  const storagePath = path.join(dir, `${fileId}-${filename}`);
  fsSync.writeFileSync(storagePath, file.buffer);

  getDb()
    .prepare('INSERT INTO item_files (id, item_id, filename, mime_type, size_bytes, storage_path) VALUES (?,?,?,?,?,?)')
    .run(fileId, item.id, filename, file.mimetype || 'application/octet-stream', file.size, storagePath);

  res.status(201).json(serializeItemFile(req.params.spaceId, item.id, {
    id: fileId, filename, mimeType: file.mimetype || 'application/octet-stream',
    sizeBytes: file.size, createdAt: Math.floor(Date.now() / 1000),
  }));
});

router.get('/:spaceId/items/:itemId/files/:fileId', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  void userId;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Item not found' }); return; }

  const record = getDb()
    .prepare('SELECT filename, mime_type as mimeType, storage_path as storagePath FROM item_files WHERE id = ? AND item_id = ?')
    .get(req.params.fileId, item.id) as { filename: string; mimeType: string; storagePath: string } | undefined;
  if (!record || !fsSync.existsSync(record.storagePath)) { res.status(404).json({ error: 'File not found' }); return; }

  res.setHeader('Content-Disposition', `inline; filename="${record.filename}"`);
  res.type(record.mimeType);
  fsSync.createReadStream(record.storagePath).pipe(res);
});

router.delete('/:spaceId/items/:itemId/files/:fileId', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  void userId;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Item not found' }); return; }

  const record = getDb()
    .prepare('SELECT storage_path as storagePath FROM item_files WHERE id = ? AND item_id = ?')
    .get(req.params.fileId, item.id) as { storagePath: string } | undefined;
  if (!record) { res.status(404).json({ error: 'File not found' }); return; }

  getDb().prepare('DELETE FROM item_files WHERE id = ?').run(req.params.fileId);
  try { fsSync.unlinkSync(record.storagePath); } catch { /* already gone */ }
  res.status(204).end();
});

export default router;
