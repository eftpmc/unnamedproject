import fs from 'fs/promises';
import path from 'path';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { ensureFilesRepo, commitFiles, resolveInFiles } from '../lib/spaceFs.js';

export interface FileRecord {
  id: string;
  space_id: string;
  path: string;
  title: string;
  type: string | null;
  status: string | null;
  mime_type: string;
  tags: Record<string, unknown>;
  source_session_id: string | null;
  created_at: number;
  updated_at: number;
}

interface FileRow extends Omit<FileRecord, 'tags'> { tags: string; }

function hydrate(row: FileRow): FileRecord {
  return { ...row, tags: JSON.parse(row.tags) as Record<string, unknown> };
}

function rowByPath(spaceId: string, p: string): FileRow | undefined {
  return getDb().prepare('SELECT * FROM files WHERE space_id = ? AND path = ?').get(spaceId, p) as FileRow | undefined;
}

function mimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.md': 'text/markdown', '.mdx': 'text/markdown',
    '.txt': 'text/plain', '.html': 'text/html', '.css': 'text/css',
    '.js': 'text/javascript', '.ts': 'text/typescript',
    '.json': 'application/json', '.xml': 'application/xml',
    '.yaml': 'application/yaml', '.yml': 'application/yaml',
  };
  return map[ext] ?? 'text/plain';
}

export async function writeFile(input: {
  space_id: string;
  path: string;
  title: string;
  tags?: Record<string, unknown>;
  body: string;
  source_session_id?: string | null;
}): Promise<FileRecord> {
  await ensureFilesRepo(input.space_id);
  const tags = input.tags ?? {};
  const abs = resolveInFiles(input.space_id, input.path);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, serializeFrontmatter(tags, input.body), 'utf-8');

  const now = Math.floor(Date.now() / 1000);
  const type = (tags.type as string | undefined) ?? null;
  const status = (tags.status as string | undefined) ?? null;
  const mime_type = mimeTypeFromPath(input.path);
  const existing = rowByPath(input.space_id, input.path);
  const id = existing?.id ?? newId();

  if (existing) {
    getDb().prepare(
      'UPDATE files SET title=?, type=?, status=?, mime_type=?, tags=?, source_session_id=COALESCE(?,source_session_id), updated_at=? WHERE id=?',
    ).run(input.title, type, status, mime_type, JSON.stringify(tags), input.source_session_id ?? null, now, id);
  } else {
    getDb().prepare(
      'INSERT INTO files (id,space_id,path,title,type,status,mime_type,tags,source_session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.space_id, input.path, input.title, type, status, mime_type, JSON.stringify(tags), input.source_session_id ?? null, now, now);
  }
  await commitFiles(input.space_id, `${existing ? 'update' : 'create'} ${input.path}`);
  return hydrate(rowByPath(input.space_id, input.path)!);
}

export async function writeBinaryFile(input: {
  space_id: string;
  path: string;
  title: string;
  mime_type: string;
  data: Buffer;
  tags?: Record<string, unknown>;
  source_session_id?: string | null;
}): Promise<FileRecord> {
  await ensureFilesRepo(input.space_id);
  const abs = resolveInFiles(input.space_id, input.path);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, input.data);

  const now = Math.floor(Date.now() / 1000);
  const tags = input.tags ?? {};
  const type = (tags.type as string | undefined) ?? null;
  const status = (tags.status as string | undefined) ?? null;
  const existing = rowByPath(input.space_id, input.path);
  const id = existing?.id ?? newId();

  if (existing) {
    getDb().prepare(
      'UPDATE files SET title=?, type=?, status=?, mime_type=?, tags=?, source_session_id=COALESCE(?,source_session_id), updated_at=? WHERE id=?',
    ).run(input.title, type, status, input.mime_type, JSON.stringify(tags), input.source_session_id ?? null, now, id);
  } else {
    getDb().prepare(
      'INSERT INTO files (id,space_id,path,title,type,status,mime_type,tags,source_session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.space_id, input.path, input.title, type, status, input.mime_type, JSON.stringify(tags), input.source_session_id ?? null, now, now);
  }
  await commitFiles(input.space_id, `${existing ? 'update' : 'add'} ${input.path}`);
  return hydrate(rowByPath(input.space_id, input.path)!);
}

export async function readFile(id: string): Promise<(FileRecord & { body: string | null }) | undefined> {
  const row = getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
  if (!row) return undefined;
  const record = hydrate(row);
  if (record.mime_type.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml'].includes(record.mime_type)) {
    const raw = await fs.readFile(resolveInFiles(row.space_id, row.path), 'utf-8');
    return { ...record, body: parseFrontmatter(raw).body };
  }
  return { ...record, body: null };
}

export function listFiles(
  spaceId: string,
  filter?: { type?: string; tags?: Record<string, unknown> },
): FileRecord[] {
  const params: unknown[] = [spaceId];
  let sql = 'SELECT * FROM files WHERE space_id = ?';
  if (filter?.type) { sql += ' AND type = ?'; params.push(filter.type); }
  if (filter?.tags) {
    for (const [k, v] of Object.entries(filter.tags)) {
      if (!/^[\w.]+$/.test(k)) throw new Error(`Invalid tag key: ${k}`);
      sql += ` AND json_extract(tags, '$.${k}') = ?`;
      params.push(v);
    }
  }
  sql += ' ORDER BY updated_at DESC, id DESC';
  return (getDb().prepare(sql).all(...params) as FileRow[]).map(hydrate);
}

export async function tagFile(id: string, tags: Record<string, unknown>): Promise<FileRecord | undefined> {
  const current = await readFile(id);
  if (!current) return undefined;
  const merged = { ...current.tags, ...tags };
  if (current.body !== null) {
    return writeFile({
      space_id: current.space_id,
      path: current.path,
      title: current.title,
      tags: merged,
      body: current.body,
      source_session_id: current.source_session_id,
    });
  }
  const now = Math.floor(Date.now() / 1000);
  const type = (merged.type as string | undefined) ?? current.type;
  const status = (merged.status as string | undefined) ?? current.status;
  getDb().prepare(
    'UPDATE files SET tags=?, type=?, status=?, updated_at=? WHERE id=?',
  ).run(JSON.stringify(merged), type, status, now, id);
  return hydrate(getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow);
}

export async function deleteFile(id: string): Promise<boolean> {
  const row = getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
  if (!row) return false;
  try {
    await fs.unlink(resolveInFiles(row.space_id, row.path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  getDb().prepare('DELETE FROM files WHERE id = ?').run(id);
  await commitFiles(row.space_id, `delete ${row.path}`);
  return true;
}
