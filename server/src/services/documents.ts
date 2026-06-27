import fs from 'fs/promises';
import path from 'path';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { ensureDocumentsRepo, commitDocuments, resolveInDocuments } from '../lib/spaceFs.js';

export interface DocumentRecord {
  id: string;
  space_id: string;
  path: string;
  title: string;
  type: string | null;
  status: string | null;
  frontmatter: Record<string, unknown>;
  source_session_id: string | null;
  created_at: number;
  updated_at: number;
}

interface DocumentRow extends Omit<DocumentRecord, 'frontmatter'> { frontmatter: string; }

function hydrate(row: DocumentRow): DocumentRecord {
  return { ...row, frontmatter: JSON.parse(row.frontmatter) as Record<string, unknown> };
}

function rowByPath(spaceId: string, p: string): DocumentRow | undefined {
  return getDb().prepare('SELECT * FROM documents WHERE space_id = ? AND path = ?').get(spaceId, p) as DocumentRow | undefined;
}

export async function writeDocument(input: {
  space_id: string;
  path: string;
  title: string;
  frontmatter?: Record<string, unknown>;
  body: string;
  source_session_id?: string | null;
}): Promise<DocumentRecord> {
  await ensureDocumentsRepo(input.space_id);
  const frontmatter = input.frontmatter ?? {};
  const abs = resolveInDocuments(input.space_id, input.path);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, serializeFrontmatter(frontmatter, input.body), 'utf-8');

  const now = Math.floor(Date.now() / 1000);
  const type = (frontmatter.type as string | undefined) ?? null;
  const status = (frontmatter.status as string | undefined) ?? null;
  const existing = rowByPath(input.space_id, input.path);
  const id = existing?.id ?? newId();

  if (existing) {
    getDb().prepare(
      'UPDATE documents SET title=?, type=?, status=?, frontmatter=?, source_session_id=COALESCE(?,source_session_id), updated_at=? WHERE id=?',
    ).run(input.title, type, status, JSON.stringify(frontmatter), input.source_session_id ?? null, now, id);
  } else {
    getDb().prepare(
      'INSERT INTO documents (id,space_id,path,title,type,status,frontmatter,source_session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.space_id, input.path, input.title, type, status, JSON.stringify(frontmatter), input.source_session_id ?? null, now, now);
  }
  await commitDocuments(input.space_id, `${existing ? 'update' : 'create'} ${input.path}`);
  return hydrate(rowByPath(input.space_id, input.path)!);
}

export async function readDocument(id: string): Promise<(DocumentRecord & { body: string }) | undefined> {
  const row = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
  if (!row) return undefined;
  const raw = await fs.readFile(resolveInDocuments(row.space_id, row.path), 'utf-8');
  return { ...hydrate(row), body: parseFrontmatter(raw).body };
}

export function listDocuments(
  spaceId: string,
  filter?: { type?: string; frontmatter?: Record<string, unknown> },
): DocumentRecord[] {
  const params: unknown[] = [spaceId];
  let sql = 'SELECT * FROM documents WHERE space_id = ?';
  if (filter?.type) { sql += ' AND type = ?'; params.push(filter.type); }
  if (filter?.frontmatter) {
    for (const [k, v] of Object.entries(filter.frontmatter)) {
      if (!/^[\w.]+$/.test(k)) throw new Error(`Invalid frontmatter key: ${k}`);
      sql += ` AND json_extract(frontmatter, '$.${k}') = ?`;
      params.push(v);
    }
  }
  sql += ' ORDER BY updated_at DESC, id DESC';
  return (getDb().prepare(sql).all(...params) as DocumentRow[]).map(hydrate);
}

export async function patchFrontmatter(id: string, patch: Record<string, unknown>): Promise<DocumentRecord | undefined> {
  const current = await readDocument(id);
  if (!current) return undefined;
  const merged = { ...current.frontmatter, ...patch };
  return writeDocument({
    space_id: current.space_id,
    path: current.path,
    title: current.title,
    frontmatter: merged,
    body: current.body,
    source_session_id: current.source_session_id,
  });
}

export async function deleteDocument(id: string): Promise<boolean> {
  const row = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
  if (!row) return false;
  try {
    await fs.unlink(resolveInDocuments(row.space_id, row.path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  getDb().prepare('DELETE FROM documents WHERE id = ?').run(id);
  await commitDocuments(row.space_id, `delete ${row.path}`);
  return true;
}
