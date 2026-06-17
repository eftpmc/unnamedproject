import fs from 'fs';
import path from 'path';
import { getDataDir, getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export type ArtifactStatus = 'ready' | 'review' | 'running' | 'error';

export interface ProjectArtifact {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  description: string | null;
  status: ArtifactStatus;
  mime_type: string;
  path: string | null;
  url: string | null;
  content_url: string | null;
  metadata: Record<string, unknown>;
  source_plan_id: string | null;
  source_step_id: string | null;
  created_at: number;
}

interface DbArtifactRow {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  description: string | null;
  status: ArtifactStatus;
  mime_type: string;
  path: string | null;
  url: string | null;
  metadata: string;
  source_plan_id: string | null;
  source_step_id: string | null;
  created_at: number;
}

export interface CreateArtifactInput {
  project_id: string;
  kind: string;
  title: string;
  description?: string | null;
  status?: ArtifactStatus;
  mime_type?: string;
  path?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
  source_plan_id?: string | null;
  source_step_id?: string | null;
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

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function mimeFor(filename: string): string {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function dbArtifacts(projectId: string): ProjectArtifact[] {
  const rows = getDb()
    .prepare(`
      SELECT id, project_id, kind, title, description, status, mime_type, path, url, metadata,
             source_plan_id, source_step_id, created_at
      FROM artifacts
      WHERE project_id = ?
    `)
    .all(projectId) as DbArtifactRow[];

  return rows.map(row => ({
    ...row,
    content_url: row.url ?? (row.path ? `/projects/${projectId}/artifacts/${encodeURIComponent(row.id)}/content` : null),
    metadata: parseMetadata(row.metadata),
  }));
}

function artifactFromRow(row: DbArtifactRow): ProjectArtifact {
  return {
    ...row,
    content_url: row.url ?? (row.path ? `/projects/${row.project_id}/artifacts/${encodeURIComponent(row.id)}/content` : null),
    metadata: parseMetadata(row.metadata),
  };
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'text/markdown') return '.md';
  if (mimeType === 'text/plain') return '.txt';
  if (mimeType === 'application/json') return '.json';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'video/mp4') return '.mp4';
  return '.bin';
}

export function createArtifact(input: CreateArtifactInput): ProjectArtifact {
  const id = newId();
  const mimeType = input.mime_type ?? 'application/octet-stream';
  getDb()
    .prepare(`
      INSERT INTO artifacts (
        id, project_id, kind, title, description, status, mime_type, path, url, metadata,
        source_plan_id, source_step_id
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    .run(
      id,
      input.project_id,
      input.kind,
      input.title,
      input.description ?? null,
      input.status ?? 'ready',
      mimeType,
      input.path ?? null,
      input.url ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.source_plan_id ?? null,
      input.source_step_id ?? null,
    );

  const row = getDb()
    .prepare(`
      SELECT id, project_id, kind, title, description, status, mime_type, path, url, metadata,
             source_plan_id, source_step_id, created_at
      FROM artifacts
      WHERE id = ?
    `)
    .get(id) as DbArtifactRow;

  return artifactFromRow(row);
}

export async function createTextArtifact(input: Omit<CreateArtifactInput, 'path' | 'url' | 'mime_type'> & {
  content: string;
  mime_type?: 'text/markdown' | 'text/plain' | 'application/json';
}): Promise<ProjectArtifact> {
  const mimeType = input.mime_type ?? 'text/markdown';
  const id = newId();
  const artifactDir = path.join(getDataDir(), 'projects', input.project_id, 'artifacts');
  const fileName = `${id}${extensionForMime(mimeType)}`;
  const relPath = `artifacts/${fileName}`;
  await fs.promises.mkdir(artifactDir, { recursive: true });
  await fs.promises.writeFile(path.join(artifactDir, fileName), input.content, 'utf-8');

  getDb()
    .prepare(`
      INSERT INTO artifacts (
        id, project_id, kind, title, description, status, mime_type, path, url, metadata,
        source_plan_id, source_step_id
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    .run(
      id,
      input.project_id,
      input.kind,
      input.title,
      input.description ?? null,
      input.status ?? 'ready',
      mimeType,
      relPath,
      null,
      JSON.stringify(input.metadata ?? {}),
      input.source_plan_id ?? null,
      input.source_step_id ?? null,
    );

  const row = getDb()
    .prepare(`
      SELECT id, project_id, kind, title, description, status, mime_type, path, url, metadata,
             source_plan_id, source_step_id, created_at
      FROM artifacts
      WHERE id = ?
    `)
    .get(id) as DbArtifactRow;

  return artifactFromRow(row);
}

export function resolveArtifactContentPath(projectId: string, artifactId: string): { filePath: string; mimeType: string } | null {
  const row = getDb()
    .prepare('SELECT project_id, mime_type, path, url FROM artifacts WHERE id = ? AND project_id = ?')
    .get(artifactId, projectId) as { project_id: string; mime_type: string; path: string | null; url: string | null } | undefined;
  if (!row?.path || row.url) return null;

  const base = path.resolve(getDataDir(), 'projects', projectId);
  const filePath = path.resolve(base, row.path);
  if (filePath !== base && !filePath.startsWith(base + path.sep)) return null;
  return { filePath, mimeType: row.mime_type };
}

function filesystemArtifacts(projectId: string): ProjectArtifact[] {
  const baseDir = path.join(getDataDir(), 'projects', projectId);
  const candidates: Array<{ dir: string; kind: string; status: ArtifactStatus; extensions?: string[] }> = [
    { dir: 'media', kind: 'media', status: 'ready' },
    { dir: 'research', kind: 'research', status: 'review', extensions: ['.md'] },
  ];

  const artifacts: ProjectArtifact[] = [];
  for (const candidate of candidates) {
    const artifactDir = path.join(baseDir, candidate.dir);
    if (!fs.existsSync(artifactDir)) continue;

    const entries = fs.readdirSync(artifactDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (candidate.extensions && !candidate.extensions.includes(ext)) continue;

      const filePath = path.join(artifactDir, entry.name);
      const stat = fs.statSync(filePath);
      const id = `${candidate.dir}:${entry.name}`;
      const url = candidate.dir === 'media'
        ? `/projects/${projectId}/media/${encodeURIComponent(entry.name)}`
        : null;

      artifacts.push({
        id,
        project_id: projectId,
        kind: candidate.kind,
        title: titleFromFilename(entry.name),
        description: null,
        status: candidate.status,
        mime_type: mimeFor(entry.name),
        path: `${candidate.dir}/${entry.name}`,
        url,
        content_url: url ?? `/projects/${projectId}/${candidate.dir}/${encodeURIComponent(entry.name)}`,
        metadata: { filename: entry.name, legacy_source: candidate.dir },
        source_plan_id: null,
        source_step_id: null,
        created_at: Math.floor((stat.birthtimeMs || stat.mtimeMs) / 1000),
      });
    }
  }

  return artifacts;
}

export async function registerFileAsArtifact(input: {
  project_id: string;
  source_path: string;
  title?: string;
  kind?: string;
}): Promise<ProjectArtifact> {
  const { readFile, copyFile, mkdir } = await import('fs/promises');
  const filename = path.basename(input.source_path);
  const mime = mimeFor(filename);
  const mediaDir = path.join(getDataDir(), 'projects', input.project_id, 'media');
  await mkdir(mediaDir, { recursive: true });
  const dest = path.join(mediaDir, filename);
  await copyFile(input.source_path, dest);
  return createArtifact({
    project_id: input.project_id,
    kind: input.kind ?? (mime.startsWith('video/') ? 'media' : mime.startsWith('image/') ? 'media' : 'file'),
    title: input.title ?? titleFromFilename(filename),
    status: 'ready',
    mime_type: mime,
    url: `/projects/${input.project_id}/media/${encodeURIComponent(filename)}`,
    path: `media/${filename}`,
    metadata: { source: input.source_path },
  });
}

export function getArtifactById(artifactId: string): ProjectArtifact | undefined {
  const row = getDb()
    .prepare('SELECT id, project_id, kind, title, description, status, mime_type, path, url, metadata, source_plan_id, source_step_id, created_at FROM artifacts WHERE id = ?')
    .get(artifactId) as DbArtifactRow | undefined;
  return row ? artifactFromRow(row) : undefined;
}

export async function readArtifactContent(projectId: string, artifactId: string): Promise<string | null> {
  // DB-backed artifact
  const resolved = resolveArtifactContentPath(projectId, artifactId);
  if (resolved) {
    const { readFile } = await import('fs/promises');
    return readFile(resolved.filePath, 'utf-8');
  }
  // Filesystem artifact with synthetic id like "research:filename.md"
  if (artifactId.includes(':')) {
    const [dir, filename] = artifactId.split(':', 2);
    const filePath = path.join(getDataDir(), 'projects', projectId, dir, filename);
    const { readFile } = await import('fs/promises');
    try {
      return readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
  return null;
}

export function listProjectArtifacts(projectId: string): ProjectArtifact[] {
  const rows = dbArtifacts(projectId);
  const rowPaths = new Set(rows.map(a => a.path).filter(Boolean));
  const bridged = filesystemArtifacts(projectId).filter(a => !rowPaths.has(a.path));
  return [...rows, ...bridged]
    .sort((a, b) => b.created_at - a.created_at);
}
