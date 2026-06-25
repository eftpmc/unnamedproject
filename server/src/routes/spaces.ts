import { Router, type Request, type Response } from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getDataDir, getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import {
  createDocumentItem,
  createFileItem,
  createNoteItem,
  createRepoItem,
  deleteItem,
  getItemById,
  getItemsForSpace,
  readItemContent,
  updateDocumentBlocks,
  updateDocumentBlock,
  updateRepoOverviewBlocks,
  updateTaskDone,
  type Block,
  type SpaceItem,
} from '../services/items.js';
import { listItemTemplates, getItemTemplate, createItemTemplate, updateItemTemplate } from '../services/templates.js';
import { validateBlock, validateBlocks } from '../lib/blocks.js';
import { detectCapabilities } from '../services/projectCapabilities.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

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
): (SpaceItem & { type: 'repo' }) | undefined {
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
  res.json(getItemsForSpace(req.params.spaceId));
});

router.get('/item-templates', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  res.json(listItemTemplates(userId));
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

router.post('/:spaceId/items', (req, res) => {
  if (!requireSpace(req, res)) return;
  const { type, name } = req.body as { type?: string; name?: string };
  if (!name?.trim() || !['repo', 'file', 'note', 'document'].includes(type ?? '')) {
    res.status(400).json({ error: 'valid type and name required' });
    return;
  }
  if (type === 'document') {
    const templateId = (req.body.template_id as string | undefined) ?? 'tpl_document';
    const template = getItemTemplate(templateId);
    if (!template || template.kind !== 'blocks') {
      res.status(404).json({ error: `Unknown template '${templateId}'` });
      return;
    }
    res.status(201).json(createDocumentItem({
      space_id: req.params.spaceId,
      name: name.trim(),
      template_id: templateId,
      blocks: template.blocks ?? [],
    }));
    return;
  }
  if (type === 'repo') {
    if (!req.body.repo_path) {
      res.status(400).json({ error: 'repo_path required' });
      return;
    }
    res.status(201).json(createRepoItem({
      space_id: req.params.spaceId,
      name: name.trim(),
      repo_path: req.body.repo_path,
      default_branch: req.body.default_branch,
    }));
    return;
  }
  if (type === 'file') {
    if (!req.body.file_path) {
      res.status(400).json({ error: 'file_path required' });
      return;
    }
    res.status(201).json(createFileItem({
      space_id: req.params.spaceId,
      name: name.trim(),
      file_path: req.body.file_path,
      size_bytes: req.body.size_bytes,
      mime_type: req.body.mime_type,
    }));
    return;
  }
  res.status(201).json(createNoteItem({
    space_id: req.params.spaceId,
    name: name.trim(),
    content: req.body.content ?? '',
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

router.patch('/:spaceId/items/:itemId', (req, res) => {
  if (!requireSpace(req, res)) return;
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'Item not found in this space' });
    return;
  }
  const { name, content, blocks, overview_blocks, block_id, block } = req.body as {
    name?: string;
    content?: string;
    blocks?: unknown[];
    overview_blocks?: unknown[] | null;
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
    if (item.type !== 'note') {
      res.status(400).json({ error: `Content editing is not supported for item type '${item.type}'` });
      return;
    }
    getDb().prepare('UPDATE space_notes SET content = ? WHERE item_id = ?').run(content, item.id);
  }
  if (blocks !== undefined) {
    if (item.type !== 'document') {
      res.status(400).json({ error: `blocks only supported for document items` });
      return;
    }
    if (!Array.isArray(blocks)) {
      res.status(400).json({ error: 'blocks must be an array' });
      return;
    }
    const blocksError = validateBlocks(blocks);
    if (blocksError) {
      res.status(400).json({ error: blocksError });
      return;
    }
    updateDocumentBlocks(item.id, blocks as Block[]);
  }
  if (block_id !== undefined) {
    if (item.type !== 'document') {
      res.status(400).json({ error: `block_id only supported for document items` });
      return;
    }
    const blockError = validateBlock(block, 'block');
    if (blockError) {
      res.status(400).json({ error: blockError });
      return;
    }
    if (!updateDocumentBlock(item.id, block_id, block as Block)) {
      res.status(404).json({ error: `No block with id '${block_id}' on this item — it may predate having an id, in which case use blocks (full replace) instead` });
      return;
    }
  }
  if (overview_blocks !== undefined) {
    if (item.type !== 'repo') {
      res.status(400).json({ error: `overview_blocks only supported for repo items` });
      return;
    }
    if (overview_blocks !== null) {
      const overviewError = validateBlocks(overview_blocks);
      if (overviewError) {
        res.status(400).json({ error: overviewError });
        return;
      }
    }
    updateRepoOverviewBlocks(item.id, overview_blocks as Block[] | null);
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
  if (item.type !== 'document') {
    res.status(400).json({ error: 'Task updates only supported on document items' });
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
  if (item.type === 'document') {
    res.status(400).json({ error: 'Content endpoint not supported for document items. Use the blocks field from GET /spaces/:spaceId/items/:itemId instead.' });
    return;
  }
  try {
    const content = await readItemContent(item);
    if (item.type === 'note') {
      res.type('text/markdown').send(content);
      return;
    }
    res.type(item.mime_type ?? 'application/octet-stream').send(content);
  } catch {
    res.status(404).json({ error: 'Item content not found' });
  }
});

router.get('/:spaceId/plans', (req, res) => {
  if (!requireSpace(req, res)) return;
  res.json(getDb().prepare(
    'SELECT * FROM plans WHERE space_id = ? ORDER BY created_at DESC',
  ).all(req.params.spaceId));
});

router.get('/:spaceId/items/:itemId/tree', async (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  try {
    const target = resolveInItem(item.repo_path, (req.query.path as string) || '');
    const entries = await fs.readdir(target, { withFileTypes: true });
    res.json({
      entries: entries
        .filter(entry => !entry.name.startsWith('.'))
        .map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
          path: path.relative(item.repo_path, path.join(target, entry.name)),
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
    res.json({ content: await fs.readFile(resolveInItem(item.repo_path, relativePath), 'utf-8'), path: relativePath });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

router.get('/:spaceId/items/:itemId/capabilities', (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  res.json(detectCapabilities(item.id, item.repo_path));
});

router.get('/:spaceId/items/:itemId/workspace', async (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  try {
    res.json({ content: await fs.readFile(path.join(item.repo_path, 'workspace.md'), 'utf-8') });
  } catch {
    res.json({ content: '' });
  }
});

router.put('/:spaceId/items/:itemId/workspace', async (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  await fs.writeFile(path.join(item.repo_path, 'workspace.md'), req.body.content ?? '', 'utf-8');
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

export default router;
