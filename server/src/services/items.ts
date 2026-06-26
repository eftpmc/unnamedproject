import fs from 'fs/promises';
import path from 'path';
import { getDataDir, getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export type BlockContent =
  | { type: 'text'; content: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'task-list'; tasks: { id: string; text: string; done: boolean }[] }
  | { type: 'callout'; variant: 'info' | 'warning' | 'success' | 'error'; content: string }
  | { type: 'file-browser' }
  | { type: 'chart'; chartType: 'line' | 'bar' | 'pie'; title?: string; data: { label: string; value: number }[] }
  | { type: 'stat'; label: string; value: string; trend?: { direction: 'up' | 'down' | 'flat'; label?: string } }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'progress'; label?: string; value: number; max?: number };

// `id` is optional because legacy blocks predate it, but any block the agent
// wants to target later with a single-block patch needs a stable one.
export type Block = BlockContent & { id?: string };

interface SpaceItemRow {
  id: string;
  space_id: string;
  type: string;
  name: string;
  source_session_id: string | null;
  created_at: number;
  page_blocks: string; // raw JSON
}

export interface SpaceItemBase {
  id: string;
  space_id: string;
  type: string;
  name: string;
  source_session_id: string | null;
  created_at: number;
  page_blocks: Block[];
}

export type RepoItem = SpaceItemBase & { type: 'repo'; repo_path: string; default_branch: string | null };
export type FileItem = SpaceItemBase & { type: 'file'; file_path: string; size_bytes: number | null; mime_type: string | null };

// repo and file have extra structured fields; all other types are base + page_blocks
export type SpaceItem = RepoItem | FileItem | SpaceItemBase;

export function isRepoItem(item: SpaceItem): item is RepoItem { return item.type === 'repo'; }
export function isFileItem(item: SpaceItem): item is FileItem { return item.type === 'file'; }

export interface CreateItemInput {
  space_id: string;
  name: string;
  source_session_id?: string | null;
}

function insertBaseRow(input: CreateItemInput, type: string, pageBlocks: Block[] = []): SpaceItemRow & { page_blocks: string } {
  const row = {
    id: newId(),
    space_id: input.space_id,
    type,
    name: input.name,
    source_session_id: input.source_session_id ?? null,
    created_at: Math.floor(Date.now() / 1000),
    page_blocks: JSON.stringify(pageBlocks),
  };
  getDb().prepare(`
    INSERT INTO space_items (id, space_id, type, name, source_session_id, created_at, page_blocks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.space_id, row.type, row.name, row.source_session_id, row.created_at, row.page_blocks);
  return row;
}

export function createRepoItem(
  input: CreateItemInput & { repo_path: string; default_branch?: string },
): RepoItem {
  return getDb().transaction((): RepoItem => {
    const base = insertBaseRow(input, 'repo');
    getDb().prepare(
      'INSERT INTO space_repos (item_id, repo_path, default_branch) VALUES (?, ?, ?)',
    ).run(base.id, input.repo_path, input.default_branch ?? null);
    return {
      ...base,
      type: 'repo',
      page_blocks: [],
      repo_path: input.repo_path,
      default_branch: input.default_branch ?? null,
    };
  })();
}

export function createFileItem(
  input: CreateItemInput & { file_path: string; size_bytes?: number; mime_type?: string },
): FileItem {
  return getDb().transaction((): FileItem => {
    const base = insertBaseRow(input, 'file');
    getDb().prepare(
      'INSERT INTO space_files (item_id, file_path, size_bytes, mime_type) VALUES (?, ?, ?, ?)',
    ).run(base.id, input.file_path, input.size_bytes ?? null, input.mime_type ?? null);
    return {
      ...base,
      type: 'file',
      page_blocks: [],
      file_path: input.file_path,
      size_bytes: input.size_bytes ?? null,
      mime_type: input.mime_type ?? null,
    };
  })();
}

// Creates any template-based item (blank, spec, kanban, report, custom, …).
// `type` is the template ID / item type name stored on the item.
export function createTemplateItem(
  input: CreateItemInput & { type: string; page_blocks: Block[] },
): SpaceItemBase {
  const base = insertBaseRow(input, input.type, input.page_blocks);
  return { ...base, page_blocks: input.page_blocks };
}

export function updateItemPageBlocks(itemId: string, blocks: Block[]): void {
  getDb().prepare('UPDATE space_items SET page_blocks = ? WHERE id = ?').run(JSON.stringify(blocks), itemId);
}

export function updateItemPageBlock(itemId: string, blockId: string, block: Block): boolean {
  const item = getItemById(itemId);
  if (!item) return false;
  const index = item.page_blocks.findIndex(b => b.id === blockId);
  if (index === -1) return false;
  const updated = [...item.page_blocks];
  updated[index] = { ...block, id: blockId };
  updateItemPageBlocks(itemId, updated);
  return true;
}

export function updateTaskDone(itemId: string, taskId: string, done: boolean): boolean {
  const item = getItemById(itemId);
  if (!item) return false;
  let found = false;
  const updated = item.page_blocks.map(block => {
    if (block.type !== 'task-list') return block;
    const tasks = block.tasks.map(task => {
      if (task.id !== taskId) return task;
      found = true;
      return { ...task, done };
    });
    return { ...block, tasks };
  });
  if (!found) return false;
  updateItemPageBlocks(itemId, updated);
  return true;
}

function hydrate(row: SpaceItemRow): SpaceItem {
  const db = getDb();
  const page_blocks: Block[] = row.page_blocks ? JSON.parse(row.page_blocks) as Block[] : [];
  const base: SpaceItemBase = { ...row, page_blocks };

  if (row.type === 'repo') {
    const subtype = db.prepare(
      'SELECT repo_path, default_branch FROM space_repos WHERE item_id = ?',
    ).get(row.id) as { repo_path: string; default_branch: string | null } | undefined;
    if (!subtype) throw new Error(`Repo item ${row.id} is missing its subtype row`);
    return { ...base, type: 'repo', repo_path: subtype.repo_path, default_branch: subtype.default_branch };
  }

  if (row.type === 'file') {
    const subtype = db.prepare(
      'SELECT file_path, size_bytes, mime_type FROM space_files WHERE item_id = ?',
    ).get(row.id) as { file_path: string; size_bytes: number | null; mime_type: string | null } | undefined;
    if (!subtype) throw new Error(`File item ${row.id} is missing its subtype row`);
    return { ...base, type: 'file', ...subtype };
  }

  // All template-based types (blank, spec, kanban, custom, …) — just base + page_blocks
  return base;
}

export function getItemsForSpace(spaceId: string): SpaceItem[] {
  const rows = getDb().prepare(
    'SELECT * FROM space_items WHERE space_id = ? ORDER BY created_at DESC, id DESC',
  ).all(spaceId) as SpaceItemRow[];
  return rows.map(hydrate);
}

export function getItemById(itemId: string): SpaceItem | undefined {
  const row = getDb().prepare('SELECT * FROM space_items WHERE id = ?').get(itemId) as SpaceItemRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function deleteItem(itemId: string): void {
  getDb().prepare('DELETE FROM space_items WHERE id = ?').run(itemId);
}

const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
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

export function mimeForPath(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export async function registerFileItem(input: CreateItemInput & {
  source_path: string;
  mime_type?: string;
}): Promise<FileItem> {
  const fileName = path.basename(input.source_path);
  const destinationDir = path.join(getDataDir(), 'spaces', input.space_id, 'files');
  await fs.mkdir(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, `${Date.now()}-${fileName}`);
  await fs.copyFile(input.source_path, destination);
  const stat = await fs.stat(destination);
  return createFileItem({
    ...input,
    file_path: destination,
    size_bytes: stat.size,
    mime_type: input.mime_type ?? mimeForPath(fileName),
  });
}

export function resolveFileItemPath(item: FileItem): string {
  if (path.isAbsolute(item.file_path)) return item.file_path;
  return path.resolve(getDataDir(), 'projects', item.space_id, item.file_path);
}

export async function readItemContent(item: SpaceItem): Promise<string | Buffer> {
  if (item.type === 'file') return fs.readFile(resolveFileItemPath(item as FileItem));
  throw new Error(`readItemContent is not supported for item type '${item.type}'`);
}
