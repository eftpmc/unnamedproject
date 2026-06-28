# Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Spaces-based tab layout with a Cloudflare-style icon-only sidebar + header, promote Projects (git repos) to top-level entities, and move Documents/Triggers to global pages.

**Architecture:** The backend gains additive top-level routes (`/projects`, `/documents`, `/triggers`) that query through the existing `spaces` table for auth — spaces become an invisible implementation detail, auto-created per project. The frontend replaces `AppLayout`, `Sidebar`, `SpacesPage`, and `SpacePage` with a new cross-layout, context-aware icon sidebar, project selector in the header, and Cloudflare-style project pages.

**Tech Stack:** React, React Router v6, TanStack Query, Tailwind CSS, Lucide icons, Express (server), better-sqlite3.

## Global Constraints

- Never remove existing `/spaces/*` routes — only add new top-level routes alongside them.
- No schema migrations — the `spaces` table stays as a backing store; new routes JOIN through it for auth.
- Sidebar collapsed width: `w-12` (48px). Expanded width: `w-56` (224px).
- Expanded sidebar overlays content (`position: absolute`) — content width never changes.
- The header is `h-12`. The logo cell is `w-12` (matches sidebar). Together they form the visual cross.
- `max-w-5xl mx-auto` for all page content columns.
- All new server routes require `requireAuthHeaderOrQuery` middleware.
- All new API functions must be exported from `web/src/lib/api.ts`.
- Run `cd server && npm test` after every server task. Run `cd web && npm test` after every frontend task.

---

## File Map

**Server — new files:**
- `server/src/routes/projects.ts` — top-level `/projects` CRUD + file browser
- `server/src/routes/documents.ts` — global `/documents` CRUD
- `server/src/routes/triggers.ts` — global `/triggers` CRUD

**Server — modified files:**
- `server/src/services/projects.ts` — add `listProjectsForUser`, `getProjectForUser`
- `server/src/index.ts` — mount new routers

**Frontend — new files:**
- `web/src/components/AppHeader.tsx` — persistent header with project selector
- `web/src/pages/ProjectsPage.tsx` — list of all projects
- `web/src/pages/ProjectPage.tsx` — Cloudflare-style project detail
- `web/src/pages/DocumentsPage.tsx` — global documents
- `web/src/pages/TriggersPage.tsx` — global triggers
- `web/src/pages/MediaPage.tsx` — global media (placeholder)

**Frontend — modified files:**
- `web/src/lib/api.ts` — new top-level API functions
- `web/src/types.ts` — no removals; `Space` type kept for backward compat with chat pinning
- `web/src/pages/AppLayout.tsx` — cross layout, custom sidebar overlay logic
- `web/src/components/Sidebar.tsx` — icon-only, context-aware, overlay behavior
- `web/src/App.tsx` — new routes, /spaces/* redirects

---

## Task 1: Backend — top-level project services

**Files:**
- Modify: `server/src/services/projects.ts`

**Interfaces:**
- Produces: `listProjectsForUser(userId: string): Project[]`
- Produces: `getProjectForUser(projectId: string, userId: string): Project | undefined`

- [ ] **Step 1: Read the existing projects service**

```bash
cat server/src/services/projects.ts
```

- [ ] **Step 2: Write failing tests**

Add to `server/src/routes/spaces-content.test.ts` or create `server/src/services/projects.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { listProjectsForUser, getProjectForUser } from './projects.js';
import { getDb } from '../db/index.js';

describe('listProjectsForUser', () => {
  it('returns only projects owned by the user via their spaces', () => {
    const db = getDb();
    // Assumes test DB is seeded with a user, space, and project
    // Check that the function returns projects scoped to userId
    const results = listProjectsForUser('test-user-id');
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('getProjectForUser', () => {
  it('returns undefined for a project owned by a different user', () => {
    const result = getProjectForUser('nonexistent-id', 'wrong-user');
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd server && npm test -- --reporter=verbose 2>&1 | grep -A3 "listProjectsForUser\|getProjectForUser"
```

- [ ] **Step 4: Add `listProjectsForUser` and `getProjectForUser` to the projects service**

Open `server/src/services/projects.ts` and add at the bottom:

```typescript
export function listProjectsForUser(userId: string): Project[] {
  return getDb().prepare(`
    SELECT p.*
    FROM projects p
    JOIN spaces s ON p.space_id = s.id
    WHERE s.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId) as Project[];
}

export function getProjectForUser(projectId: string, userId: string): Project | undefined {
  return getDb().prepare(`
    SELECT p.*
    FROM projects p
    JOIN spaces s ON p.space_id = s.id
    WHERE p.id = ? AND s.user_id = ?
  `).get(projectId, userId) as Project | undefined;
}
```

(Import `getDb` from `'../db/index.js'` if not already imported — check the existing imports first.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/projects.ts
git commit -m "feat(projects): add listProjectsForUser and getProjectForUser"
```

---

## Task 2: Backend — top-level project routes

**Files:**
- Create: `server/src/routes/projects.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `listProjectsForUser`, `getProjectForUser` from Task 1
- Consumes: `createProject`, `linkProject`, `deleteProject`, `getProject` from existing `services/projects.ts`
- Produces: `GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`, `DELETE /projects/:id`, `GET /projects/:id/tree`, `GET /projects/:id/file`

- [ ] **Step 1: Write failing route tests**

Create `server/src/routes/projects.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import projectsRouter from './projects.js';

// Minimal app for route testing
const app = express();
app.use(express.json());
// Mock auth middleware for tests
app.use((req, _res, next) => {
  (req as any).userId = 'test-user';
  next();
});
app.use('/projects', projectsRouter);

describe('GET /projects', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /projects', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/projects').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /projects/:id', () => {
  it('returns 404 for nonexistent project', async () => {
    const res = await request(app).get('/projects/nonexistent');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test -- projects.test
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `server/src/routes/projects.ts`**

```typescript
import path from 'path';
import fs from 'fs/promises';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { listProjectsForUser, getProjectForUser, createProject, linkProject, deleteProject } from '../services/projects.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

function resolveInRepo(repoPath: string, relPath: string): string {
  const root = path.resolve(repoPath);
  const resolved = path.resolve(root, relPath || '.');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes repository root');
  }
  return resolved;
}

// List all projects for the authenticated user
router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  res.json(listProjectsForUser(userId));
});

// Create or link a project (auto-creates a backing space)
router.post('/', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { name, repo_path, default_branch } = req.body as {
    name?: string;
    repo_path?: string;
    default_branch?: string | null;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name required' });
    return;
  }
  // Auto-create a backing space for this project
  const spaceId = newId();
  getDb().prepare(
    'INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?, ?, ?, NULL, ?)',
  ).run(spaceId, userId, name.trim(), '[]');

  const project = repo_path
    ? linkProject({ space_id: spaceId, name: name.trim(), repo_path, default_branch })
    : await createProject({ space_id: spaceId, name: name.trim() });

  res.status(201).json(project);
});

// Get a single project
router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  res.json(project);
});

// Update project name or default branch
router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const { name, default_branch } = req.body as { name?: string; default_branch?: string | null };
  const fields: string[] = [];
  const values: unknown[] = [];
  if (name?.trim()) { fields.push('name = ?'); values.push(name.trim()); }
  if (default_branch !== undefined) { fields.push('default_branch = ?'); values.push(default_branch); }
  if (fields.length > 0) {
    values.push(project.id);
    getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    // Keep the backing space name in sync
    if (name?.trim()) {
      getDb().prepare('UPDATE spaces SET name = ? WHERE id = ?').run(name.trim(), project.space_id);
    }
  }
  res.json(getProjectForUser(req.params.id, userId));
});

// Delete project and its backing space
router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  deleteProject(project.id);
  getDb().prepare('DELETE FROM spaces WHERE id = ?').run(project.space_id);
  res.status(204).end();
});

// File browser — directory listing
router.get('/:id/tree', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const relPath = (req.query.path as string | undefined) ?? '';
  let dir: string;
  try { dir = resolveInRepo(project.repo_path, relPath); } catch {
    res.status(400).json({ error: 'Invalid path' }); return;
  }
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const prefix = relPath ? `${relPath}/` : '';
    res.json({ entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', path: `${prefix}${e.name}` })) });
  } catch {
    res.status(404).json({ error: 'Path not found' });
  }
});

// File browser — file content
router.get('/:id/file', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const relPath = (req.query.path as string | undefined) ?? '';
  let filePath: string;
  try { filePath = resolveInRepo(project.repo_path, relPath); } catch {
    res.status(400).json({ error: 'Invalid path' }); return;
  }
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ path: relPath, content });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

export default router;
```

- [ ] **Step 4: Mount the router in `server/src/index.ts`**

Add import after the existing space imports:
```typescript
import projectsRoutes from './routes/projects.js';
```

Add mount after `app.use('/spaces', ...)`:
```typescript
app.use('/projects', wrapAsyncErrors(projectsRoutes));
```

- [ ] **Step 5: Run tests**

```bash
cd server && npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/projects.ts server/src/index.ts
git commit -m "feat(projects): add top-level /projects routes"
```

---

## Task 3: Backend — global documents and triggers routes

**Files:**
- Create: `server/src/routes/documents.ts`
- Create: `server/src/routes/triggers.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Produces: `GET /documents`, `GET /documents/:id`, `POST /documents`, `PATCH /documents/:id`, `DELETE /documents/:id`
- Produces: `GET /triggers`, `POST /triggers`, `DELETE /triggers/:id`

- [ ] **Step 1: Write failing tests for documents route**

Create `server/src/routes/documents.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import documentsRouter from './documents.js';

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as any).userId = 'test-user'; next(); });
app.use('/documents', documentsRouter);

describe('GET /documents', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/documents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /documents/:id', () => {
  it('returns 404 for nonexistent doc', async () => {
    const res = await request(app).get('/documents/nonexistent');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test -- documents.test
```

- [ ] **Step 3: Create `server/src/routes/documents.ts`**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { writeDocument, readDocument, patchFrontmatter, deleteDocument, listDocuments } from '../services/documents.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

// List all documents for this user across all their spaces
router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { type } = req.query as Record<string, string>;
  const rows = getDb().prepare(`
    SELECT d.*
    FROM documents d
    JOIN spaces s ON d.space_id = s.id
    WHERE s.user_id = ?
    ${type ? 'AND d.type = ?' : ''}
    ORDER BY d.updated_at DESC
  `).all(...(type ? [userId, type] : [userId])) as Array<Record<string, unknown>>;
  res.json(rows.map(row => ({
    ...row,
    frontmatter: typeof row.frontmatter === 'string' ? JSON.parse(row.frontmatter as string) : row.frontmatter,
  })));
});

// Get a single document (auth: must be owned by user's space)
router.get('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const doc = await readDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  // Verify ownership
  const space = getDb().prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?').get(doc.space_id, userId);
  if (!space) { res.status(404).json({ error: 'Document not found' }); return; }
  res.json(doc);
});

// Update document
router.patch('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const doc = await readDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const space = getDb().prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?').get(doc.space_id, userId);
  if (!space) { res.status(404).json({ error: 'Document not found' }); return; }
  const { frontmatter, title, body } = req.body as {
    frontmatter?: Record<string, unknown>; title?: string; body?: string;
  };
  if (title === undefined && body === undefined && frontmatter) {
    res.json(await patchFrontmatter(doc.id, frontmatter));
    return;
  }
  res.json(await writeDocument({
    space_id: doc.space_id,
    path: doc.path,
    title: title ?? doc.title,
    frontmatter: { ...doc.frontmatter, ...(frontmatter ?? {}) },
    body: body ?? doc.body,
  }));
});

// Delete document
router.delete('/:id', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const doc = await readDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const space = getDb().prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?').get(doc.space_id, userId);
  if (!space) { res.status(404).json({ error: 'Document not found' }); return; }
  await deleteDocument(doc.id);
  res.status(204).end();
});

export default router;
```

- [ ] **Step 4: Create `server/src/routes/triggers.ts`**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuthHeaderOrQuery, type AuthedRequest } from '../middleware/auth.js';
import { listTriggers, createTrigger, deleteTrigger } from '../services/triggers.js';
import { nextCronRun } from '../lib/cron.js';
import type { Trigger } from '../types.js';

const router = Router();
router.use(requireAuthHeaderOrQuery);

// List all triggers for this user across all their spaces
router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const rows = getDb().prepare(`
    SELECT t.*
    FROM triggers t
    JOIN spaces s ON t.space_id = s.id
    WHERE s.user_id = ?
    ORDER BY t.created_at DESC
  `).all(userId) as Trigger[];
  res.json(rows);
});

// Create a trigger — requires a project_id to derive the space
router.post('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { kind, schedule_cron, playbook_id, project_id } = req.body as {
    kind?: 'schedule' | 'webhook' | 'manual';
    schedule_cron?: string | null;
    playbook_id?: string | null;
    project_id?: string | null;
  };
  if (!kind || !['schedule', 'webhook', 'manual'].includes(kind)) {
    res.status(400).json({ error: 'kind required (schedule|webhook|manual)' });
    return;
  }
  // Resolve space_id: if project_id given, look up its space; else use first user space
  let spaceId: string | undefined;
  if (project_id) {
    const row = getDb().prepare(`
      SELECT p.space_id FROM projects p
      JOIN spaces s ON p.space_id = s.id
      WHERE p.id = ? AND s.user_id = ?
    `).get(project_id, userId) as { space_id: string } | undefined;
    if (!row) { res.status(400).json({ error: 'Project not found' }); return; }
    spaceId = row.space_id;
  } else {
    const row = getDb().prepare('SELECT id FROM spaces WHERE user_id = ? LIMIT 1').get(userId) as { id: string } | undefined;
    if (!row) { res.status(400).json({ error: 'No space available — create a project first' }); return; }
    spaceId = row.id;
  }
  let next_run_at: number | null = null;
  if (kind === 'schedule' && schedule_cron) {
    try {
      next_run_at = nextCronRun(schedule_cron, Math.floor(Date.now() / 1000));
    } catch {
      res.status(400).json({ error: 'invalid schedule_cron expression' });
      return;
    }
  }
  res.status(201).json(createTrigger({
    space_id: spaceId,
    kind,
    schedule_cron: schedule_cron ?? null,
    playbook_id: playbook_id ?? null,
    next_run_at,
  }));
});

// Delete a trigger (auth: must be in user's space)
router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb().prepare(`
    SELECT t.id FROM triggers t
    JOIN spaces s ON t.space_id = s.id
    WHERE t.id = ? AND s.user_id = ?
  `).get(req.params.id, userId) as { id: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Trigger not found' }); return; }
  deleteTrigger(row.id);
  res.status(204).end();
});

export default router;
```

- [ ] **Step 5: Mount both routers in `server/src/index.ts`**

```typescript
import documentsRoutes from './routes/documents.js';
import triggersRoutes from './routes/triggers.js';
```

```typescript
app.use('/documents', wrapAsyncErrors(documentsRoutes));
app.use('/triggers', wrapAsyncErrors(triggersRoutes));
```

- [ ] **Step 6: Run all tests**

```bash
cd server && npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/documents.ts server/src/routes/triggers.ts server/src/index.ts
git commit -m "feat: add global /documents and /triggers routes"
```

---

## Task 4: Frontend — API layer updates

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/types.ts`

**Interfaces:**
- Produces (api.ts):
  - `getProjects(): Promise<Project[]>`
  - `getProject(id: string): Promise<Project>`
  - `createTopLevelProject(body: { name: string; repo_path?: string; default_branch?: string }): Promise<Project>`
  - `updateProject(id: string, body: { name?: string; default_branch?: string | null }): Promise<Project>`
  - `deleteTopLevelProject(id: string): Promise<void>`
  - `getProjectTree(id: string, dirPath?: string): Promise<{ entries: FileEntry[] }>`
  - `getProjectFile(id: string, filePath: string): Promise<{ content: string; path: string }>`
  - `getAllDocuments(params?: { type?: string }): Promise<Document[]>`
  - `getDocumentById(id: string): Promise<DocumentWithBody>`
  - `updateDocumentById(id: string, body: { title?: string; body?: string; frontmatter?: Record<string, unknown> }): Promise<Document>`
  - `deleteDocumentById(id: string): Promise<void>`
  - `getAllTriggers(): Promise<Trigger[]>`
  - `createGlobalTrigger(body: { kind: Trigger['kind']; schedule_cron?: string; playbook_id?: string; project_id?: string }): Promise<Trigger>`
  - `deleteGlobalTrigger(id: string): Promise<void>`

- [ ] **Step 1: Write failing API tests**

Add to `web/src/lib/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getProjects, createTopLevelProject, getAllDocuments, getAllTriggers } from './api.js';

// Mock fetch
global.fetch = vi.fn();

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  localStorage.setItem('token', 'test-token');
});

function mockOk(data: unknown) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => data,
  } as unknown as Response);
}

describe('getProjects', () => {
  it('calls GET /projects', async () => {
    mockOk([]);
    const result = await getProjects();
    expect(fetch).toHaveBeenCalledWith('/projects', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }));
    expect(result).toEqual([]);
  });
});

describe('createTopLevelProject', () => {
  it('calls POST /projects with name', async () => {
    mockOk({ id: '1', name: 'test', space_id: 'sp1', repo_path: '', default_branch: null, origin: 'created', created_at: 0 });
    await createTopLevelProject({ name: 'test' });
    expect(fetch).toHaveBeenCalledWith('/projects', expect.objectContaining({ method: 'POST' }));
  });
});

describe('getAllDocuments', () => {
  it('calls GET /documents', async () => {
    mockOk([]);
    await getAllDocuments();
    expect(fetch).toHaveBeenCalledWith('/documents', expect.anything());
  });
});

describe('getAllTriggers', () => {
  it('calls GET /triggers', async () => {
    mockOk([]);
    await getAllTriggers();
    expect(fetch).toHaveBeenCalledWith('/triggers', expect.anything());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npm test -- api.test
```

- [ ] **Step 3: Add new functions to `web/src/lib/api.ts`**

Append to the end of `web/src/lib/api.ts` (before the final blank line):

```typescript
// ─── Top-level Projects ───────────────────────────────────────────────────────

export function getProjects(): Promise<Project[]> {
  return request('/projects');
}

export function getProject(id: string): Promise<Project> {
  return request(`/projects/${id}`);
}

export function createTopLevelProject(body: { name: string; repo_path?: string; default_branch?: string | null }): Promise<Project> {
  return request('/projects', { method: 'POST', body: JSON.stringify(body) });
}

export function updateProject(id: string, body: { name?: string; default_branch?: string | null }): Promise<Project> {
  return request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteTopLevelProject(id: string): Promise<void> {
  return request(`/projects/${id}`, { method: 'DELETE' });
}

export function getProjectTree(id: string, dirPath?: string): Promise<{ entries: FileEntry[] }> {
  const q = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  return request(`/projects/${id}/tree${q}`);
}

export function getProjectFile(id: string, filePath: string): Promise<{ content: string; path: string }> {
  return request(`/projects/${id}/file?path=${encodeURIComponent(filePath)}`);
}

// ─── Global Documents ─────────────────────────────────────────────────────────

export function getAllDocuments(params?: { type?: string }): Promise<Document[]> {
  const q = params?.type ? `?type=${encodeURIComponent(params.type)}` : '';
  return request(`/documents${q}`);
}

export function getDocumentById(id: string): Promise<DocumentWithBody> {
  return request(`/documents/${id}`);
}

export function updateDocumentById(id: string, body: { title?: string; body?: string; frontmatter?: Record<string, unknown> }): Promise<Document> {
  return request(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteDocumentById(id: string): Promise<void> {
  return request(`/documents/${id}`, { method: 'DELETE' });
}

// ─── Global Triggers ──────────────────────────────────────────────────────────

export function getAllTriggers(): Promise<Trigger[]> {
  return request('/triggers');
}

export function createGlobalTrigger(body: { kind: Trigger['kind']; schedule_cron?: string; playbook_id?: string; project_id?: string }): Promise<Trigger> {
  return request('/triggers', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteGlobalTrigger(id: string): Promise<void> {
  return request(`/triggers/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npm test -- api.test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(api): add top-level projects, global documents and triggers API functions"
```

---

## Task 5: Frontend — AppLayout + Sidebar redesign

**Files:**
- Modify: `web/src/pages/AppLayout.tsx`
- Modify: `web/src/components/Sidebar.tsx`

The new layout uses a **custom sidebar** (not the shadcn `SidebarProvider`). The sidebar is always present at `w-12` (48px) in the document flow. When expanded, it becomes `position: absolute` and overlays content at `w-56` (224px). Content margin is always `ml-12` and never changes.

**Layout structure:**
```
<div class="flex h-screen flex-col">                   ← root
  <header class="flex h-12 shrink-0 items-center">     ← AppHeader
    <div class="w-12 ...">logo</div>
    <div class="flex-1 ...">selector + right</div>
  </header>
  <div class="relative flex min-h-0 flex-1">           ← body row
    <nav class="w-12 shrink-0 ...">                    ← sidebar (always 48px in flow)
      [when expanded: absolute w-56 z-10 h-full]
    </nav>
    <main class="min-h-0 flex-1 overflow-auto">        ← content (always full width minus 48px)
      ...
    </main>
  </div>
</div>
```

- [ ] **Step 1: Write sidebar behavior tests**

Create `web/src/components/Sidebar.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppSidebar from './Sidebar.js';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>
);

describe('AppSidebar', () => {
  it('renders icon-only nav items by default (collapsed)', () => {
    render(wrap(<AppSidebar expanded={false} onToggle={() => {}} />));
    // Icons present, labels hidden
    expect(screen.queryByText('Chats')).not.toBeInTheDocument();
  });

  it('shows labels when expanded', () => {
    render(wrap(<AppSidebar expanded={true} onToggle={() => {}} />));
    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npm test -- Sidebar.test
```

- [ ] **Step 3: Rewrite `web/src/components/Sidebar.tsx`**

Replace the entire file:

```typescript
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  FileText,
  FolderGit2,
  Image,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Files,
  Zap,
} from 'lucide-react';
import { getProject } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import type { Project } from '../types.js';

interface SidebarProps {
  expanded: boolean;
  onToggle: () => void;
}

export default function AppSidebar({ expanded, onToggle }: SidebarProps) {
  const location = useLocation();
  const params = useParams<{ projectId?: string }>();
  const isInProject = location.pathname.startsWith('/projects/') && !!params.projectId;

  const { data: project } = useQuery<Project>({
    queryKey: ['project', params.projectId],
    queryFn: () => getProject(params.projectId!),
    enabled: isInProject,
  });

  return (
    <nav
      className={cn(
        'absolute inset-y-0 left-0 z-10 flex h-full flex-col border-r border-border-soft bg-background transition-[width] duration-200',
        expanded ? 'w-56' : 'w-12',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden py-2">
        {isInProject ? (
          <ProjectNav projectId={params.projectId!} project={project ?? null} expanded={expanded} pathname={location.pathname} />
        ) : (
          <GlobalNav expanded={expanded} pathname={location.pathname} />
        )}
      </div>
    </nav>
  );
}

function GlobalNav({ expanded, pathname }: { expanded: boolean; pathname: string }) {
  return (
    <>
      <NavItem icon={<MessageSquare size={16} strokeWidth={1.75} />} label="Chats" href="/chats" active={pathname.startsWith('/chats')} expanded={expanded} />
      <NavItem icon={<FolderGit2 size={16} strokeWidth={1.75} />} label="Projects" href="/projects" active={pathname === '/projects'} expanded={expanded} />
      <NavItem icon={<FileText size={16} strokeWidth={1.75} />} label="Documents" href="/documents" active={pathname.startsWith('/documents')} expanded={expanded} />
      <NavItem icon={<Image size={16} strokeWidth={1.75} />} label="Media" href="/media" active={pathname.startsWith('/media')} expanded={expanded} />
      <NavItem icon={<Zap size={16} strokeWidth={1.75} />} label="Triggers" href="/triggers" active={pathname.startsWith('/triggers')} expanded={expanded} />
      <div className="flex-1" />
      <NavItem icon={<Settings size={16} strokeWidth={1.75} />} label="Settings" href="/settings" active={pathname.startsWith('/settings')} expanded={expanded} />
    </>
  );
}

function ProjectNav({ projectId, project, expanded, pathname }: { projectId: string; project: Project | null; expanded: boolean; pathname: string }) {
  const base = `/projects/${projectId}`;
  return (
    <>
      <NavItem icon={<ArrowLeft size={16} strokeWidth={1.75} />} label="Projects" href="/projects" active={false} expanded={expanded} />
      <div className="my-1 border-t border-border-soft" />
      <NavItem icon={<LayoutDashboard size={16} strokeWidth={1.75} />} label="Overview" href={base} active={pathname === base} expanded={expanded} />
      <NavItem icon={<Files size={16} strokeWidth={1.75} />} label="Files" href={`${base}/files`} active={pathname.startsWith(`${base}/files`)} expanded={expanded} />
      <NavItem icon={<MessageSquare size={16} strokeWidth={1.75} />} label="Chats" href={`${base}/chats`} active={pathname.startsWith(`${base}/chats`)} expanded={expanded} />
    </>
  );
}

function NavItem({ icon, label, href, active, expanded }: { icon: React.ReactNode; label: string; href: string; active: boolean; expanded: boolean }) {
  return (
    <Link
      to={href}
      title={!expanded ? label : undefined}
      className={cn(
        'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
        'mx-1 text-muted-foreground hover:bg-muted hover:text-foreground',
        active && 'bg-muted text-foreground',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {expanded && <span className="truncate">{label}</span>}
    </Link>
  );
}
```

- [ ] **Step 4: Rewrite `web/src/pages/AppLayout.tsx`**

Replace the entire file:

```typescript
import { useEffect, useRef, useState } from 'react';
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AppSidebar from '../components/Sidebar.js';
import AppHeader from '../components/AppHeader.js';
import ChatView from '../components/ChatView.js';
import EmptyState from '../components/EmptyState.js';
import InboxPanel from '../components/InboxPanel.js';
import ErrorBoundary from '../components/ErrorBoundary.js';
import { getConnections, getAgentProviders } from '../lib/api.js';
import { connect, disconnect, subscribe } from '../lib/ws.js';
import { cn } from '../lib/utils.js';
import type { AgentProvider, Connection, Session, WSApprovalRequested, WSExecutionUpdate, WSTurnComplete } from '../types.js';

const PAGE_ROUTES = ['/chats', '/projects', '/documents', '/media', '/triggers', '/settings', '/spaces'];

export default function AppLayout() {
  const { chatId } = useParams<{ chatId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Map<string, string>>(new Map());
  const [inboxOpen, setInboxOpen] = useState(false);

  const chatIdRef = useRef(chatId);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);

  // Close sidebar on route change (mobile UX)
  useEffect(() => { setSidebarExpanded(false); }, [location.pathname]);

  const { data: agentProviders = [] } = useQuery<AgentProvider[]>({ queryKey: ['agent-providers'], queryFn: getAgentProviders, staleTime: 60_000 });
  const hasLeadAgent = agentProviders.length > 0;

  useEffect(() => {
    connect();
    const unsub = subscribe(event => {
      if (event.type === 'approval_requested') {
        const e = event as unknown as WSApprovalRequested;
        setPendingApprovals(prev => new Map(prev).set(e.executionId, e.approvalId));
        if ('Notification' in window) {
          const isCurrentChat = e.sessionId ? chatIdRef.current === e.sessionId : false;
          if (!isCurrentChat || document.visibilityState !== 'visible') {
            const label = e.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const fire = () => {
              const n = new Notification('Approval needed', { body: label, icon: '/favicon.ico', tag: `approval-${e.executionId}`, requireInteraction: true });
              if (e.sessionId) n.onclick = () => { window.focus(); navigate(`/c/${e.sessionId}`); };
            };
            if (Notification.permission === 'granted') fire();
            else if (Notification.permission === 'default') Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
          }
        }
      } else if (event.type === 'execution_update') {
        const e = event as unknown as WSExecutionUpdate;
        if (e.status === 'running' || e.status === 'done' || e.status === 'error') {
          setPendingApprovals(prev => { const next = new Map(prev); next.delete(e.executionId); return next; });
        }
      } else if (event.type === 'turn_complete') {
        const e = event as unknown as WSTurnComplete;
        if (e.status === 'done' && 'Notification' in window) {
          const isCurrentChat = chatIdRef.current === e.sessionId;
          if (!isCurrentChat || document.visibilityState !== 'visible') {
            const chats = queryClient.getQueryData<Session[]>(['chats']);
            const title = chats?.find(c => c.id === e.sessionId)?.title ?? 'Agent finished';
            const fire = () => new Notification('unnamed', { body: title, icon: '/favicon.ico', tag: e.sessionId });
            if (Notification.permission === 'granted') fire();
            else if (Notification.permission === 'default') Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
          }
        }
      }
    });
    return () => { unsub(); disconnect(); };
  }, [queryClient, navigate]);

  function handleApprovalResolved(executionId: string) {
    setPendingApprovals(prev => { const next = new Map(prev); next.delete(executionId); return next; });
  }

  const isPageRoute = PAGE_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));
  const mainContent = isPageRoute
    ? <Outlet />
    : chatId
      ? <ChatView chatId={chatId} />
      : <EmptyState hasLeadAgent={hasLeadAgent} />;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Header — always h-12, full width */}
      <AppHeader
        onToggleSidebar={() => setSidebarExpanded(v => !v)}
        pendingApprovalCount={pendingApprovals.size}
        onOpenInbox={() => setInboxOpen(true)}
      />

      {/* Body row — sidebar + content */}
      <div className="relative flex min-h-0 flex-1">
        {/* Sidebar: always 48px in layout flow; when expanded, overlays as absolute */}
        <div className="w-12 shrink-0" aria-hidden />
        <AppSidebar expanded={sidebarExpanded} onToggle={() => setSidebarExpanded(v => !v)} />

        {/* Overlay backdrop when sidebar is expanded */}
        {sidebarExpanded && (
          <div
            className="absolute inset-0 z-[9] bg-black/20"
            onClick={() => setSidebarExpanded(false)}
            aria-hidden
          />
        )}

        {/* Main content — always starts at 0, fills remaining space */}
        <main className="min-h-0 flex-1 overflow-auto">
          <ErrorBoundary key={location.pathname}>
            {mainContent}
          </ErrorBoundary>
        </main>
      </div>

      <InboxPanel
        open={inboxOpen}
        onOpenChange={setInboxOpen}
        pendingApprovals={pendingApprovals}
        onApprovalResolved={handleApprovalResolved}
      />
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

```bash
cd web && npm test -- Sidebar.test
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Sidebar.tsx web/src/pages/AppLayout.tsx
git commit -m "feat(layout): icon-only overlay sidebar + cross layout in AppLayout"
```

---

## Task 6: Frontend — AppHeader with project selector

**Files:**
- Create: `web/src/components/AppHeader.tsx`

The header is `h-12` and has three zones:
1. **Logo cell** — exactly `w-12`, contains the brand mark and sidebar toggle
2. **Center** — project selector (when inside a project) or app name (global)
3. **Right** — user menu, inbox bell

- [ ] **Step 1: Create `web/src/components/AppHeader.tsx`**

```typescript
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronsUpDown, Check, Menu } from 'lucide-react';
import { useState } from 'react';
import { getProjects, getProject } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import UserMenu from './UserMenu.js';
import type { Project } from '../types.js';

interface AppHeaderProps {
  onToggleSidebar: () => void;
  pendingApprovalCount: number;
  onOpenInbox: () => void;
}

export default function AppHeader({ onToggleSidebar, pendingApprovalCount, onOpenInbox }: AppHeaderProps) {
  const location = useLocation();
  const params = useParams<{ projectId?: string }>();
  const isInProject = location.pathname.startsWith('/projects/') && !!params.projectId;

  const { data: currentProject } = useQuery<Project>({
    queryKey: ['project', params.projectId],
    queryFn: () => getProject(params.projectId!),
    enabled: isInProject,
  });

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border-soft bg-background">
      {/* Logo cell — same width as collapsed sidebar */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation"
        className="flex h-12 w-12 shrink-0 items-center justify-center border-r border-border-soft transition-colors hover:bg-muted"
      >
        <div className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
          u
        </div>
      </button>

      {/* Center — project selector or empty */}
      <div className="flex min-w-0 flex-1 items-center px-3">
        {isInProject && currentProject ? (
          <ProjectSelector currentProject={currentProject} />
        ) : null}
      </div>

      {/* Right — inbox + user menu */}
      <div className="flex items-center gap-1 px-3">
        <button
          type="button"
          onClick={onOpenInbox}
          aria-label="Open inbox"
          className="relative grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell size={15} strokeWidth={1.75} />
          {pendingApprovalCount > 0 && (
            <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-semibold text-warning-foreground">
              {pendingApprovalCount}
            </span>
          )}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

function ProjectSelector({ currentProject }: { currentProject: Project }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 60_000,
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-muted"
      >
        <span className="truncate max-w-48">{currentProject.name}</span>
        <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-border bg-background shadow-lg">
            <div className="border-b border-border-soft px-3 py-2">
              <input
                autoFocus
                placeholder="Search projects..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-faint-fg"
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {projects.map(project => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => { navigate(`/projects/${project.id}`); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                    project.id === currentProject.id && 'text-primary',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                  {project.repo_path && (
                    <span className="shrink-0 truncate font-mono text-[11px] text-faint-fg max-w-28">{project.repo_path.split('/').slice(-2).join('/')}</span>
                  )}
                  {project.id === currentProject.id && <Check size={13} className="shrink-0" />}
                </button>
              ))}
            </div>
            <div className="border-t border-border-soft px-3 py-2">
              <button
                type="button"
                onClick={() => { navigate('/projects'); setOpen(false); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                All projects →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run web tests**

```bash
cd web && npm test
```

Expected: all pass (AppHeader has no test file yet — integration tested via AppLayout).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AppHeader.tsx
git commit -m "feat(header): AppHeader with project selector dropdown"
```

---

## Task 7: Frontend — ProjectsPage

**Files:**
- Create: `web/src/pages/ProjectsPage.tsx`

List of all projects. Each card shows name, repo path, branch. Actions: create (name only) or link (name + path + branch).

- [ ] **Step 1: Create `web/src/pages/ProjectsPage.tsx`**

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, GitBranch, Plus } from 'lucide-react';
import { getProjects, createTopLevelProject, deleteTopLevelProject } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Project } from '../types.js';

export default function ProjectsPage() {
  usePageTitle('Projects');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [branch, setBranch] = useState('');

  const { data: projects = [], isLoading } = useQuery<Project[]>({ queryKey: ['projects'], queryFn: getProjects });

  const createMutation = useMutation({
    mutationFn: () => createTopLevelProject({
      name: name.trim(),
      ...(repoPath.trim() ? { repo_path: repoPath.trim() } : {}),
      ...(branch.trim() ? { default_branch: branch.trim() } : {}),
    }),
    onSuccess: project => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setName(''); setRepoPath(''); setBranch('');
      navigate(`/projects/${project.id}`);
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Projects"
        className="border-0 pb-0"
        contentClassName="max-w-5xl"
        actions={
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen(true)}>
            <Plus size={14} />New project
          </Button>
        }
      />

      {isLoading ? <PageLoading rows={3} /> : projects.length === 0 ? (
        <CenteredEmptyState
          title="No projects yet"
          description="Create a project or link a local git repository."
          actionLabel="New project"
          onAction={() => setOpen(true)}
        />
      ) : (
        <PageBody>
          <ContentColumn className="max-w-5xl">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map(project => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-400">
                      <FolderGit2 size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{project.name}</span>
                      {project.default_branch && (
                        <span className="flex items-center gap-1 text-[11px] text-faint-fg">
                          <GitBranch size={10} />{project.default_branch}
                        </span>
                      )}
                    </span>
                  </div>
                  {project.repo_path && (
                    <span className="truncate font-mono text-[11px] text-faint-fg">{project.repo_path}</span>
                  )}
                </button>
              ))}
            </div>
          </ContentColumn>
        </PageBody>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Create empty or link an existing repository.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Input placeholder="Project name" value={name} onChange={e => setName(e.target.value)} autoFocus />
            <Input placeholder="Local repo path (optional)" value={repoPath} onChange={e => setRepoPath(e.target.value)} />
            <Input placeholder="Default branch (optional)" value={branch} onChange={e => setBranch(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
```

- [ ] **Step 2: Run web tests**

```bash
cd web && npm test
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ProjectsPage.tsx
git commit -m "feat(projects): add ProjectsPage with card grid"
```

---

## Task 8: Frontend — ProjectPage (Cloudflare-style)

**Files:**
- Create: `web/src/pages/ProjectPage.tsx`

Three sub-routes: `/projects/:id` (Overview), `/projects/:id/files`, `/projects/:id/chats`. The sidebar (from Task 5) already renders the project nav items when the route matches `/projects/:id`. This page handles the three views.

- [ ] **Step 1: Create `web/src/pages/ProjectPage.tsx`**

```typescript
import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, MessageSquare, Plus, Trash2 } from 'lucide-react';
import {
  getProject, updateProject, deleteTopLevelProject,
  getChats, createChat, updateChatConfig,
  getConnections, updateSpace, getSpaces,
} from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import FileBrowser from '../components/FileBrowser.js';
import type { Connection, Project, Session } from '../types.js';

type SubRoute = 'overview' | 'files' | 'chats';

function subRoute(pathname: string, projectId: string): SubRoute {
  const suffix = pathname.slice(`/projects/${projectId}`.length).split('/').filter(Boolean)[0];
  if (suffix === 'files') return 'files';
  if (suffix === 'chats') return 'chats';
  return 'overview';
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const view = subRoute(location.pathname, projectId!);

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });

  usePageTitle(project?.name);

  const { data: chats = [] } = useQuery<Session[]>({ queryKey: ['chats'], queryFn: () => getChats() });
  const projectChats = chats.filter(c => c.pinned_space_id === project?.space_id);

  const startChat = useMutation({
    mutationFn: async () => {
      const created = await createChat();
      await updateChatConfig(created.id, { pinned_space_id: project!.space_id });
      return created.id;
    },
    onSuccess: id => navigate(`/c/${id}`),
  });

  if (isLoading) return <PageShell><PageLoading rows={4} /></PageShell>;
  if (!project) return <PageShell><PageHeader title="Project not found" /></PageShell>;

  if (view === 'files') {
    return (
      <PageShell>
        <PageHeader title="Files" contentClassName="max-w-5xl" className="border-0 pb-0" />
        <PageBody className="p-4 sm:p-5">
          <FileBrowser spaceId={project.space_id} projectId={project.id} projectName={project.name} />
        </PageBody>
      </PageShell>
    );
  }

  if (view === 'chats') {
    return (
      <PageShell>
        <PageHeader
          title="Chats"
          contentClassName="max-w-5xl"
          className="border-0 pb-0"
          actions={
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => startChat.mutate()} disabled={startChat.isPending}>
              <MessageSquare size={14} />New chat
            </Button>
          }
        />
        <PageBody>
          <ContentColumn className="max-w-5xl">
            {projectChats.length === 0 ? (
              <EmptyPanel
                title="No chats yet"
                description="Start a chat pinned to this project."
                action={<Button size="sm" onClick={() => startChat.mutate()}>Start chat</Button>}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {projectChats.sort((a, b) => b.updated_at - a.updated_at).map(chat => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => navigate(`/c/${chat.id}`)}
                    className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm"
                  >
                    <MessageSquare size={15} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.title ?? 'Untitled chat'}</span>
                    <span className="shrink-0 text-xs text-faint-fg">{timeAgo(chat.updated_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </ContentColumn>
        </PageBody>
      </PageShell>
    );
  }

  // Overview (default)
  return <ProjectOverview project={project} chats={projectChats} onNewChat={() => startChat.mutate()} />;
}

function ProjectOverview({ project, chats, onNewChat }: { project: Project; chats: Session[]; onNewChat: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editBranch, setEditBranch] = useState(project.default_branch ?? '');

  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const mcpConnections = connections.filter(c => c.type === 'mcp');

  // Load space to read enabled_connection_ids
  const { data: spaces = [] } = useQuery({
    queryKey: ['spaces'],
    queryFn: getSpaces,
    staleTime: 60_000,
  });
  const space = (spaces as { id: string; enabled_connection_ids: string[] }[]).find(s => s.id === project.space_id);

  const updateMutation = useMutation({
    mutationFn: () => updateProject(project.id, {
      name: editName.trim() || project.name,
      default_branch: editBranch.trim() || null,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTopLevelProject(project.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); navigate('/projects'); },
  });

  function toggleMcp(connectionId: string) {
    if (!space) return;
    const current = space.enabled_connection_ids ?? [];
    const updated = current.includes(connectionId) ? current.filter(id => id !== connectionId) : [...current, connectionId];
    updateSpace(project.space_id, { enabled_connection_ids: updated }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['spaces'] }),
    );
  }

  const recentChats = [...chats].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5);

  return (
    <PageShell>
      <PageHeader title="Overview" contentClassName="max-w-5xl" className="border-0 pb-0"
        actions={
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onNewChat}>
            <MessageSquare size={14} />New chat
          </Button>
        }
      />
      <PageBody>
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-6 lg:flex-row lg:items-start">

          {/* Main column */}
          <div className="min-w-0 flex-1 flex flex-col gap-6">
            {/* Repo info */}
            {project.repo_path && (
              <div className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
                <GitBranch size={14} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{project.repo_path}</span>
                {project.default_branch && (
                  <span className="rounded-md bg-muted px-2 py-1 font-mono text-[11px]">{project.default_branch}</span>
                )}
              </div>
            )}

            {/* Recent chats */}
            {recentChats.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Recent chats</span>
                  <button type="button" onClick={() => navigate(`/projects/${project.id}/chats`)} className="text-[11px] text-faint-fg hover:text-muted-foreground">View all →</button>
                </div>
                {recentChats.map(chat => (
                  <button key={chat.id} type="button" onClick={() => navigate(`/c/${chat.id}`)}
                    className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm"
                  >
                    <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.title ?? 'Untitled chat'}</span>
                    <span className="shrink-0 text-xs text-faint-fg">{timeAgo(chat.updated_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="flex w-full flex-col gap-4 lg:w-72 lg:shrink-0">
            {/* Settings */}
            <div className="rounded-xl border border-border-soft bg-card p-4">
              <h3 className="mb-3 text-xs font-semibold text-muted-foreground">Project</h3>
              <div className="flex flex-col gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Name</label>
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Default branch</label>
                  <Input value={editBranch} onChange={e => setEditBranch(e.target.value)} placeholder="main" className="h-8 text-xs" />
                </div>
                <Button size="sm" className="h-7 text-xs" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                  {updateMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>

            {/* MCP tools */}
            {mcpConnections.length > 0 && (
              <div className="rounded-xl border border-border-soft bg-card p-4">
                <h3 className="mb-3 text-xs font-semibold text-muted-foreground">MCP tools</h3>
                <div className="flex flex-col gap-2">
                  {mcpConnections.map(conn => {
                    const enabled = (space?.enabled_connection_ids ?? []).includes(conn.id);
                    return (
                      <div key={conn.id} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{conn.name}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() => toggleMcp(conn.id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}
                        >
                          <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Danger zone */}
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
              <h3 className="mb-1 text-xs font-semibold text-destructive">Danger zone</h3>
              <p className="mb-3 text-[11px] text-muted-foreground">Permanently deletes this project and its documents.</p>
              <Button variant="destructive" size="sm" className="h-7 text-xs w-full" onClick={() => setConfirmDelete(true)}>
                Delete project
              </Button>
            </div>
          </div>
        </div>
      </PageBody>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${project.name}?`}
          description="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </PageShell>
  );
}
```

- [ ] **Step 2: Run web tests**

```bash
cd web && npm test
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ProjectPage.tsx
git commit -m "feat(projects): add ProjectPage with Overview/Files/Chats views"
```

---

## Task 9: Frontend — DocumentsPage, TriggersPage, MediaPage

**Files:**
- Create: `web/src/pages/DocumentsPage.tsx`
- Create: `web/src/pages/TriggersPage.tsx`
- Create: `web/src/pages/MediaPage.tsx`

- [ ] **Step 1: Create `web/src/pages/DocumentsPage.tsx`**

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search } from 'lucide-react';
import { getAllDocuments } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Input } from '@/components/ui/input';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Document } from '../types.js';

export default function DocumentsPage() {
  usePageTitle('Documents');
  const [search, setSearch] = useState('');

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ['documents-global'],
    queryFn: () => getAllDocuments(),
  });

  const visible = search.trim()
    ? documents.filter(d => d.title.toLowerCase().includes(search.toLowerCase()))
    : documents;

  return (
    <PageShell>
      <PageHeader title="Documents" className="border-0 pb-0" contentClassName="max-w-5xl" />

      {isLoading ? <PageLoading rows={4} /> : documents.length === 0 ? (
        <CenteredEmptyState
          title="No documents yet"
          description="Documents created by the agent will appear here."
        />
      ) : (
        <PageBody>
          <ContentColumn className="max-w-5xl">
            <div className="relative mb-5">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search documents…"
                className="pl-8"
              />
            </div>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No results for "{search}".</p>
            ) : (
              <div className="flex flex-col gap-2">
                {visible.map(doc => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
                      <FileText size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{doc.title}</span>
                      <span className="block text-[11px] text-faint-fg">
                        {[doc.type, timeAgo(doc.updated_at)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {doc.status && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                        {doc.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ContentColumn>
        </PageBody>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 2: Create `web/src/pages/TriggersPage.tsx`**

```typescript
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { getAllTriggers } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import TriggersSection from '../components/TriggersSection.js';
import type { Trigger } from '../types.js';

export default function TriggersPage() {
  usePageTitle('Triggers');

  const { data: triggers = [], isLoading } = useQuery<Trigger[]>({
    queryKey: ['triggers-global'],
    queryFn: getAllTriggers,
  });

  return (
    <PageShell>
      <PageHeader title="Triggers" className="border-0 pb-0" contentClassName="max-w-5xl" />
      <PageBody>
        <ContentColumn className="max-w-5xl">
          {isLoading ? <PageLoading rows={3} /> : (
            <TriggersSection spaceId={null} globalTriggers={triggers} />
          )}
        </ContentColumn>
      </PageBody>
    </PageShell>
  );
}
```

> **Note:** `TriggersSection` currently requires a `spaceId`. Pass `null` and update `TriggersSection` to accept `null` (renders all global triggers, uses `createGlobalTrigger` instead of `createTrigger`). If that refactor is complex, use a simple inline list for now:

```typescript
// Inline version (simpler, avoids TriggersSection refactor):
<div className="flex flex-col gap-2">
  {triggers.length === 0 ? (
    <CenteredEmptyState title="No triggers yet" description="Triggers created by the agent will appear here." />
  ) : triggers.map(t => (
    <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3">
      <Zap size={14} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium capitalize">{t.kind}</span>
        {t.schedule_cron && <span className="block font-mono text-[11px] text-faint-fg">{t.schedule_cron}</span>}
      </span>
    </div>
  ))}
</div>
```

- [ ] **Step 3: Create `web/src/pages/MediaPage.tsx`**

```typescript
import { usePageTitle } from '../lib/usePageTitle.js';
import { CenteredEmptyState, PageHeader, PageShell } from '@/components/ui/app-layout';

export default function MediaPage() {
  usePageTitle('Media');
  return (
    <PageShell>
      <PageHeader title="Media" className="border-0 pb-0" contentClassName="max-w-5xl" />
      <CenteredEmptyState
        title="No media yet"
        description="Images and files created by the agent will appear here."
      />
    </PageShell>
  );
}
```

- [ ] **Step 4: Run web tests**

```bash
cd web && npm test
```

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/DocumentsPage.tsx web/src/pages/TriggersPage.tsx web/src/pages/MediaPage.tsx
git commit -m "feat: add global DocumentsPage, TriggersPage, MediaPage"
```

---

## Task 10: Frontend — Routing update

**Files:**
- Modify: `web/src/App.tsx`

Wire all new pages into the router and redirect old `/spaces/*` routes.

- [ ] **Step 1: Update `web/src/App.tsx`**

Replace the file:

```typescript
import { createBrowserRouter, RouterProvider, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RequireAuth from './components/RequireAuth.js';
import Login from './pages/Login.js';
import AppLayout from './pages/AppLayout.js';
import Settings from './pages/Settings.js';
import ChatsPage from './pages/ChatsPage.js';
import ProjectsPage from './pages/ProjectsPage.js';
import ProjectPage from './pages/ProjectPage.js';
import DocumentsPage from './pages/DocumentsPage.js';
import TriggersPage from './pages/TriggersPage.js';
import MediaPage from './pages/MediaPage.js';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/', element: <Navigate to="/c" replace /> },
  { path: '/s', element: <Navigate to="/c" replace /> },
  { path: '/s/:sessionId', element: <Navigate to="/c" replace /> },
  {
    path: '/',
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: 'c', element: null },
      { path: 'c/:chatId', element: null },
      { path: 'chats', element: <ChatsPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId', element: <ProjectPage /> },
      { path: 'projects/:projectId/files', element: <ProjectPage /> },
      { path: 'projects/:projectId/chats', element: <ProjectPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'media', element: <MediaPage /> },
      { path: 'triggers', element: <TriggersPage /> },
      { path: 'settings', element: <Settings /> },
      // Legacy redirects
      { path: 'spaces', element: <Navigate to="/projects" replace /> },
      { path: 'spaces/:spaceId', element: <Navigate to="/projects" replace /> },
      { path: 'spaces/:spaceId/*', element: <Navigate to="/projects" replace /> },
      { path: 'activity', element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Run all web tests**

```bash
cd web && npm test
```

- [ ] **Step 3: Build the web app and check for TypeScript errors**

```bash
cd web && npm run build 2>&1 | head -50
```

Expected: builds without errors. Fix any TypeScript errors before proceeding.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(routing): wire new pages, redirect /spaces/* to /projects"
```

---

## Task 11: Smoke test + cleanup

- [ ] **Step 1: Run full test suite**

```bash
cd server && npm test && cd ../web && npm test
```

Expected: all pass.

- [ ] **Step 2: Start the app and verify manually**

```bash
cd server && npm run dev &
cd web && npm run dev
```

Check:
- [ ] Navigating to `/projects` shows ProjectsPage (grid of projects)
- [ ] Clicking a project opens ProjectPage with Overview / Files / Chats in the sidebar
- [ ] Sidebar is icon-only by default; clicking the logo expands it as an overlay
- [ ] Header shows project name + selector dropdown when inside a project
- [ ] Navigating to `/documents`, `/triggers`, `/media` works
- [ ] Old `/spaces` URLs redirect to `/projects`
- [ ] Chat view still works; pinned space shows correctly on chats page
- [ ] Mobile: sidebar closes on route change

- [ ] **Step 3: Final commit**

```bash
git add -p  # review any unstaged changes
git commit -m "feat: navigation redesign complete — Cloudflare-style layout with Projects as top-level entity"
```
