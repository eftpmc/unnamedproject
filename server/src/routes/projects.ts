import { Router } from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getDb, getDataDir, getCampaignsForProject, getProjectForUser } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { detectCapabilities } from '../services/projectCapabilities.js';
import { listProjectArtifacts, resolveArtifactContentPath } from '../services/artifacts.js';

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

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids, created_at FROM projects WHERE user_id = ? ORDER BY name')
    .all(userId) as any[];
  res.json(rows.map(r => ({ ...r, enabled_connection_ids: JSON.parse(r.enabled_connection_ids) })));
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { name, description, repo_path, enabled_connection_ids = [] } = req.body as {
    name?: string; description?: string; repo_path?: string; enabled_connection_ids?: string[];
  };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  const id = newId();
  try {
    getDb()
      .prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(id, userId, name, description ?? null, repo_path ?? null, JSON.stringify(enabled_connection_ids));
  } catch {
    res.status(409).json({ error: 'Project name already exists' });
    return;
  }
  res.status(201).json({ id, name });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const result = getDb()
    .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(204).send();
});

function getProjectBasePath(project: { id: string; repo_path: string | null }): string | null {
  if (project.repo_path) return project.repo_path;
  const dir = path.join(getDataDir(), 'doc-projects', project.id, 'files');
  return dir;
}

function resolveInProject(base: string, relPath: string): string {
  const resolved = path.resolve(base, relPath || '.');
  const baseResolved = path.resolve(base);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
    throw new Error('Path escapes project root');
  }
  return resolved;
}

router.get('/:id/tree', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id, repo_path FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; repo_path: string | null } | undefined;
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const base = getProjectBasePath(project);
  if (!base) { res.json({ entries: [] }); return; }

  try {
    await fs.mkdir(base, { recursive: true });
    const target = resolveInProject(base, (req.query.path as string) || '');
    const entries = await fs.readdir(target, { withFileTypes: true });
    const result = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', path: path.relative(base, path.join(target, e.name)) }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    res.json({ entries: result, base_is_repo: !!project.repo_path });
  } catch {
    res.json({ entries: [], base_is_repo: !!project.repo_path });
  }
});

router.get('/:id/file', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id, repo_path FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; repo_path: string | null } | undefined;
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const base = getProjectBasePath(project);
  if (!base) { res.status(404).json({ error: 'No files directory' }); return; }

  const filePath = (req.query.path as string) || '';
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  try {
    const target = resolveInProject(base, filePath);
    const content = await fs.readFile(target, 'utf-8');
    res.json({ content, path: filePath });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

router.get('/:id/campaigns', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(getCampaignsForProject(req.params.id));
});

router.get('/:id/capabilities', requireAuthHeaderOrQuery, (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id, repo_path FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; repo_path: string | null } | undefined;

  if (!project) {
    res.status(404).json({ error: 'project not found' });
    return;
  }

  res.json(detectCapabilities(project.id, project.repo_path));
});

router.get('/:id/artifacts', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  res.json({ artifacts: listProjectArtifacts(project.id) });
});

router.get('/:id/artifacts/:artifactId/content', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const resolved = resolveArtifactContentPath(project.id, req.params.artifactId);
  if (!resolved || !fsSync.existsSync(resolved.filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.type(resolved.mimeType).send(fsSync.readFileSync(resolved.filePath));
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { description } = req.body as { description?: string };
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  if (description !== undefined) {
    getDb()
      .prepare('UPDATE projects SET description = ? WHERE id = ? AND user_id = ?')
      .run(description, req.params.id, userId);
  }
  res.json({ ok: true });
});

router.get('/:id/media', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const mediaDir = path.join(getDataDir(), 'projects', project.id, 'media');
  if (!fsSync.existsSync(mediaDir)) { res.json({ files: [] }); return; }

  const entries = fsSync.readdirSync(mediaDir, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile())
    .map(e => {
      const stat = fsSync.statSync(path.join(mediaDir, e.name));
      return {
        name: e.name,
        url: `/projects/${project.id}/media/${e.name}`,
        createdAt: stat.birthtimeMs,
      };
    });
  res.json({ files });
});

router.get('/:id/media/:filename', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { filename } = req.params;

  if (filename.includes('/') || filename.includes('..')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const mediaDir = path.join(getDataDir(), 'projects', project.id, 'media');
  const filePath = path.join(mediaDir, filename);
  if (!fsSync.existsSync(filePath)) { res.status(404).json({ error: 'Not found' }); return; }

  const ext = path.extname(filename).toLowerCase();
  const contentType = MEDIA_CONTENT_TYPES[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');

  const stat = fsSync.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  let stream: fsSync.ReadStream;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    stream = fsSync.createReadStream(filePath, { start, end });
  } else {
    res.setHeader('Content-Length', fileSize);
    stream = fsSync.createReadStream(filePath);
  }

  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500);
    }
    res.destroy();
  });
  stream.pipe(res);
});

function researchFileTitle(filename: string): string {
  return filename
    .replace(/\.md$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

router.get('/:id/research', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const researchDir = path.join(getDataDir(), 'projects', project.id, 'research');
  if (!fsSync.existsSync(researchDir)) {
    res.json({ files: [] });
    return;
  }

  const files = fsSync.readdirSync(researchDir)
    .filter(f => f.endsWith('.md'))
    .map(name => {
      const stat = fsSync.statSync(path.join(researchDir, name));
      return { name, title: researchFileTitle(name), createdAt: stat.birthtimeMs || stat.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  res.json({ files });
});

router.get('/:id/research/:filename', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const researchDir = path.join(getDataDir(), 'projects', project.id, 'research');
  const rawFilename = req.params.filename;

  // Path traversal guard: reject any filename containing slashes or dots that escape
  if (rawFilename.includes('/') || rawFilename.includes('..') || rawFilename.includes('\0')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const filename = path.basename(rawFilename);
  const filePath = path.join(researchDir, filename);

  if (!fsSync.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const content = fsSync.readFileSync(filePath, 'utf-8');
  res.type('text/plain').send(content);
});

export default router;
