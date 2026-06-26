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
  | { type: 'progress'; label?: string; value: number; max?: number }
  | { type: 'input'; label: string; value: string; placeholder?: string; input_type?: 'text' | 'number' | 'multiline' | 'select'; options?: string[] };

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
  page_blocks: string;
  fields: string;
}

export interface SpaceItemBase {
  id: string;
  space_id: string;
  type: string;
  name: string;
  source_session_id: string | null;
  created_at: number;
  page_blocks: Block[];
  fields: Record<string, unknown>;
}

export type SpaceItem = SpaceItemBase;

export interface CreateItemInput {
  space_id: string;
  name: string;
  type: string;
  page_blocks?: Block[];
  fields?: Record<string, unknown>;
  source_session_id?: string | null;
}

function ensureBlockIds(blocks: Block[]): Block[] {
  return blocks.map(b => b.id ? b : { ...b, id: newId() });
}

export function createItem(input: CreateItemInput): SpaceItemBase {
  const blocks = ensureBlockIds(input.page_blocks ?? []);
  const fields = input.fields ?? {};
  const row = {
    id: newId(),
    space_id: input.space_id,
    type: input.type,
    name: input.name,
    source_session_id: input.source_session_id ?? null,
    created_at: Math.floor(Date.now() / 1000),
    page_blocks: JSON.stringify(blocks),
    fields: JSON.stringify(fields),
  };
  getDb().prepare(`
    INSERT INTO space_items (id, space_id, type, name, source_session_id, created_at, page_blocks, fields)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.space_id, row.type, row.name, row.source_session_id, row.created_at, row.page_blocks, row.fields);
  return { ...row, page_blocks: blocks, fields };
}

function hydrate(row: SpaceItemRow): SpaceItemBase {
  return {
    ...row,
    page_blocks: row.page_blocks ? JSON.parse(row.page_blocks) as Block[] : [],
    fields: row.fields ? JSON.parse(row.fields) as Record<string, unknown> : {},
  };
}

export function getItemsForSpace(spaceId: string): SpaceItemBase[] {
  const rows = getDb().prepare(
    'SELECT * FROM space_items WHERE space_id = ? ORDER BY created_at DESC, id DESC',
  ).all(spaceId) as SpaceItemRow[];
  return rows.map(hydrate);
}

export function getItemById(itemId: string): SpaceItemBase | undefined {
  const row = getDb().prepare('SELECT * FROM space_items WHERE id = ?').get(itemId) as SpaceItemRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function deleteItem(itemId: string): void {
  getDb().prepare('DELETE FROM space_items WHERE id = ?').run(itemId);
}

export function updateItemPageBlocks(itemId: string, blocks: Block[]): void {
  getDb().prepare('UPDATE space_items SET page_blocks = ? WHERE id = ?').run(JSON.stringify(ensureBlockIds(blocks)), itemId);
}

export function appendItemPageBlocks(itemId: string, blocks: Block[]): boolean {
  const item = getItemById(itemId);
  if (!item) return false;
  updateItemPageBlocks(itemId, [...item.page_blocks, ...blocks]);
  return true;
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

export function updateItemFields(itemId: string, fields: Record<string, unknown>): boolean {
  const item = getItemById(itemId);
  if (!item) return false;
  const merged = { ...item.fields, ...fields };
  getDb().prepare('UPDATE space_items SET fields = ? WHERE id = ?').run(JSON.stringify(merged), itemId);
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
}): Promise<SpaceItemBase> {
  const fileName = path.basename(input.source_path);
  const destinationDir = path.join(getDataDir(), 'spaces', input.space_id, 'files');
  await fs.mkdir(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, `${Date.now()}-${fileName}`);
  await fs.copyFile(input.source_path, destination);
  const stat = await fs.stat(destination);
  return createItem({
    ...input,
    type: 'file',
    fields: {
      file_path: destination,
      size_bytes: stat.size,
      mime_type: input.mime_type ?? mimeForPath(fileName),
    },
  });
}
