import fs from 'fs/promises';
import path from 'path';
import { getDataDir, getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export type SpaceItemType = 'repo' | 'file' | 'note';

interface SpaceItemRow {
  id: string;
  space_id: string;
  type: SpaceItemType;
  name: string;
  source_session_id: string | null;
  source_plan_id: string | null;
  source_step_id: string | null;
  created_at: number;
}

export interface SpaceItemBase extends SpaceItemRow {}

export type SpaceItem =
  | (SpaceItemBase & { type: 'repo'; repo_path: string; default_branch: string | null })
  | (SpaceItemBase & { type: 'file'; file_path: string; size_bytes: number | null; mime_type: string | null })
  | (SpaceItemBase & { type: 'note'; content: string });

export interface CreateItemInput {
  space_id: string;
  name: string;
  source_session_id?: string | null;
  source_plan_id?: string | null;
  source_step_id?: string | null;
}

function insertBaseRow(input: CreateItemInput, type: SpaceItemType): SpaceItemRow {
  const row: SpaceItemRow = {
    id: newId(),
    space_id: input.space_id,
    type,
    name: input.name,
    source_session_id: input.source_session_id ?? null,
    source_plan_id: input.source_plan_id ?? null,
    source_step_id: input.source_step_id ?? null,
    created_at: Math.floor(Date.now() / 1000),
  };
  getDb().prepare(`
    INSERT INTO space_items (
      id, space_id, type, name,
      source_session_id, source_plan_id, source_step_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.space_id,
    row.type,
    row.name,
    row.source_session_id,
    row.source_plan_id,
    row.source_step_id,
    row.created_at,
  );
  return row;
}

export function createRepoItem(
  input: CreateItemInput & { repo_path: string; default_branch?: string },
): SpaceItem {
  return getDb().transaction((): SpaceItem => {
    const base = insertBaseRow(input, 'repo');
    getDb().prepare(
      'INSERT INTO space_repos (item_id, repo_path, default_branch) VALUES (?, ?, ?)',
    ).run(base.id, input.repo_path, input.default_branch ?? null);
    return {
      ...base,
      type: 'repo',
      repo_path: input.repo_path,
      default_branch: input.default_branch ?? null,
    };
  })();
}

export function createFileItem(
  input: CreateItemInput & { file_path: string; size_bytes?: number; mime_type?: string },
): SpaceItem {
  return getDb().transaction((): SpaceItem => {
    const base = insertBaseRow(input, 'file');
    getDb().prepare(
      'INSERT INTO space_files (item_id, file_path, size_bytes, mime_type) VALUES (?, ?, ?, ?)',
    ).run(base.id, input.file_path, input.size_bytes ?? null, input.mime_type ?? null);
    return {
      ...base,
      type: 'file',
      file_path: input.file_path,
      size_bytes: input.size_bytes ?? null,
      mime_type: input.mime_type ?? null,
    };
  })();
}

export function createNoteItem(input: CreateItemInput & { content: string }): SpaceItem {
  return getDb().transaction((): SpaceItem => {
    const base = insertBaseRow(input, 'note');
    getDb().prepare('INSERT INTO space_notes (item_id, content) VALUES (?, ?)').run(base.id, input.content);
    return { ...base, type: 'note', content: input.content };
  })();
}

function hydrate(row: SpaceItemRow): SpaceItem {
  const db = getDb();
  if (row.type === 'repo') {
    const subtype = db.prepare(
      'SELECT repo_path, default_branch FROM space_repos WHERE item_id = ?',
    ).get(row.id) as { repo_path: string; default_branch: string | null } | undefined;
    if (!subtype) throw new Error(`Repo item ${row.id} is missing its subtype row`);
    return { ...row, type: 'repo', ...subtype };
  }
  if (row.type === 'file') {
    const subtype = db.prepare(
      'SELECT file_path, size_bytes, mime_type FROM space_files WHERE item_id = ?',
    ).get(row.id) as { file_path: string; size_bytes: number | null; mime_type: string | null } | undefined;
    if (!subtype) throw new Error(`File item ${row.id} is missing its subtype row`);
    return { ...row, type: 'file', ...subtype };
  }
  const subtype = db.prepare(
    'SELECT content FROM space_notes WHERE item_id = ?',
  ).get(row.id) as { content: string } | undefined;
  if (!subtype) throw new Error(`Note item ${row.id} is missing its subtype row`);
  return { ...row, type: 'note', content: subtype.content };
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
}): Promise<SpaceItem & { type: 'file' }> {
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
  }) as SpaceItem & { type: 'file' };
}

export function resolveFileItemPath(item: SpaceItem & { type: 'file' }): string {
  if (path.isAbsolute(item.file_path)) return item.file_path;
  return path.resolve(getDataDir(), 'projects', item.space_id, item.file_path);
}

export async function readItemContent(item: SpaceItem): Promise<string | Buffer> {
  if (item.type === 'note') return item.content;
  if (item.type === 'file') return fs.readFile(resolveFileItemPath(item));
  throw new Error("Operation not supported for item type 'repo'");
}
