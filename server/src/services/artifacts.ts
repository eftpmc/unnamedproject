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
  source_campaign_id: string | null;
  source_task_id: string | null;
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
  source_campaign_id: string | null;
  source_task_id: string | null;
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
  source_campaign_id?: string | null;
  source_task_id?: string | null;
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
             source_campaign_id, source_task_id, created_at
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
        source_campaign_id, source_task_id
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
      input.source_campaign_id ?? null,
      input.source_task_id ?? null,
    );

  const row = getDb()
    .prepare(`
      SELECT id, project_id, kind, title, description, status, mime_type, path, url, metadata,
             source_campaign_id, source_task_id, created_at
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
        source_campaign_id, source_task_id
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
      input.source_campaign_id ?? null,
      input.source_task_id ?? null,
    );

  const row = getDb()
    .prepare(`
      SELECT id, project_id, kind, title, description, status, mime_type, path, url, metadata,
             source_campaign_id, source_task_id, created_at
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
        source_campaign_id: null,
        source_task_id: null,
        created_at: Math.floor((stat.birthtimeMs || stat.mtimeMs) / 1000),
      });
    }
  }

  return artifacts;
}

export function listProjectArtifacts(projectId: string): ProjectArtifact[] {
  const rows = dbArtifacts(projectId);
  const rowPaths = new Set(rows.map(a => a.path).filter(Boolean));
  const bridged = filesystemArtifacts(projectId).filter(a => !rowPaths.has(a.path));
  return [...rows, ...bridged]
    .sort((a, b) => b.created_at - a.created_at);
}
