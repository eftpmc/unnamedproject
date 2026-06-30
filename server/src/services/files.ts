import fs from 'fs/promises';
import path from 'path';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { ensureFilesRepo, commitFiles, resolveInFiles } from '../lib/spaceFs.js';

export interface FileRecord {
  id: string;
  project_id: string;
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

function getFilesPath(projectId: string): string {
  const row = getDb().prepare('SELECT files_path FROM projects WHERE id = ?').get(projectId) as { files_path: string } | undefined;
  if (!row) throw new Error(`Project ${projectId} not found`);
  return row.files_path;
}

function rowByPath(projectId: string, p: string): FileRow | undefined {
  return getDb().prepare('SELECT * FROM files WHERE project_id = ? AND path = ?').get(projectId, p) as FileRow | undefined;
}

export function mimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.md': 'text/markdown', '.mdx': 'text/markdown',
    '.txt': 'text/plain', '.html': 'text/html', '.css': 'text/css',
    '.js': 'text/javascript', '.ts': 'text/typescript',
    '.json': 'application/json', '.xml': 'application/xml',
    '.yaml': 'application/yaml', '.yml': 'application/yaml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] ?? 'text/plain';
}

export async function writeFile(input: {
  project_id: string;
  path: string;
  title: string;
  tags?: Record<string, unknown>;
  body: string;
  source_session_id?: string | null;
}): Promise<FileRecord> {
  const filesPath = getFilesPath(input.project_id);
  await ensureFilesRepo(filesPath);
  const tags = input.tags ?? {};
  const abs = resolveInFiles(filesPath, input.path);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, serializeFrontmatter(tags, input.body), 'utf-8');

  const now = Math.floor(Date.now() / 1000);
  const type = (tags.type as string | undefined) ?? null;
  const status = (tags.status as string | undefined) ?? null;
  const mime_type = mimeTypeFromPath(input.path);
  const existing = rowByPath(input.project_id, input.path);
  const id = existing?.id ?? newId();

  if (existing) {
    getDb().prepare(
      'UPDATE files SET title=?, type=?, status=?, mime_type=?, tags=?, source_session_id=COALESCE(?,source_session_id), updated_at=? WHERE id=?',
    ).run(input.title, type, status, mime_type, JSON.stringify(tags), input.source_session_id ?? null, now, id);
  } else {
    getDb().prepare(
      'INSERT INTO files (id,project_id,path,title,type,status,mime_type,tags,source_session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.project_id, input.path, input.title, type, status, mime_type, JSON.stringify(tags), input.source_session_id ?? null, now, now);
  }
  await commitFiles(filesPath, `${existing ? 'update' : 'create'} ${input.path}`);
  return hydrate(rowByPath(input.project_id, input.path)!);
}

export async function writeBinaryFile(input: {
  project_id: string;
  path: string;
  title: string;
  mime_type: string;
  data: Buffer;
  tags?: Record<string, unknown>;
  source_session_id?: string | null;
}): Promise<FileRecord> {
  const filesPath = getFilesPath(input.project_id);
  await ensureFilesRepo(filesPath);
  const abs = resolveInFiles(filesPath, input.path);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, input.data);

  const now = Math.floor(Date.now() / 1000);
  const tags = input.tags ?? {};
  const type = (tags.type as string | undefined) ?? null;
  const status = (tags.status as string | undefined) ?? null;
  const existing = rowByPath(input.project_id, input.path);
  const id = existing?.id ?? newId();

  if (existing) {
    getDb().prepare(
      'UPDATE files SET title=?, type=?, status=?, mime_type=?, tags=?, source_session_id=COALESCE(?,source_session_id), updated_at=? WHERE id=?',
    ).run(input.title, type, status, input.mime_type, JSON.stringify(tags), input.source_session_id ?? null, now, id);
  } else {
    getDb().prepare(
      'INSERT INTO files (id,project_id,path,title,type,status,mime_type,tags,source_session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.project_id, input.path, input.title, type, status, input.mime_type, JSON.stringify(tags), input.source_session_id ?? null, now, now);
  }
  await commitFiles(filesPath, `${existing ? 'update' : 'add'} ${input.path}`);
  return hydrate(rowByPath(input.project_id, input.path)!);
}

export async function readFile(id: string): Promise<(FileRecord & { body: string | null }) | undefined> {
  const row = getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
  if (!row) return undefined;
  const record = hydrate(row);
  if (record.mime_type.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml'].includes(record.mime_type)) {
    const filesPath = getFilesPath(row.project_id);
    const raw = await fs.readFile(resolveInFiles(filesPath, row.path), 'utf-8');
    return { ...record, body: parseFrontmatter(raw).body };
  }
  return { ...record, body: null };
}

export function listFiles(
  projectId: string,
  filter?: { type?: string; tags?: Record<string, unknown> },
): FileRecord[] {
  const params: unknown[] = [projectId];
  let sql = 'SELECT * FROM files WHERE project_id = ?';
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
      project_id: current.project_id,
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
  const filesPath = getFilesPath(row.project_id);
  try {
    await fs.unlink(resolveInFiles(filesPath, row.path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  getDb().prepare('DELETE FROM files WHERE id = ?').run(id);
  await commitFiles(filesPath, `delete ${row.path}`);
  return true;
}
