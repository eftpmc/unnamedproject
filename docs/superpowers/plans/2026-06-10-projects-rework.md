# Workspaces → Projects Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename "workspaces" to "projects" throughout the app, make `repo_path` optional, and give the agent tools to create/update/delete projects (delete requires user approval).

**Architecture:** Schema rename (`workspaces` → `projects`, `executions.workspace_id` → `project_id`, new `user_settings` table for `projects_root`). Server-side rename of routes/tools from `workspace_*` to `project_*`. New `project_ops.ts` tool module for `create_project`/`update_project`/`delete_project`, wired into `agent.ts` dispatch and system prompt. Frontend renamed in lockstep (types, API client, nav, settings page).

**Tech Stack:** Node/Express/TypeScript, better-sqlite3, simple-git, Vitest/Supertest, React/Vite, TanStack Query.

Spec: `docs/superpowers/specs/2026-06-10-projects-rework-design.md`

---

### Task 1: Database schema — `projects`, `user_settings`, `executions.project_id`

**Files:**
- Modify: `server/src/db/index.ts`
- Modify: `server/tests/db.test.ts`

- [ ] **Step 1: Update the schema test to expect the new tables**

Edit `server/tests/db.test.ts`, replacing the `workspaces` expectation and adding `user_settings`:

```typescript
    expect(names).toContain('users');
    expect(names).toContain('connections');
    expect(names).toContain('projects');
    expect(names).toContain('user_settings');
    expect(names).toContain('sessions');
    expect(names).toContain('messages');
    expect(names).toContain('executions');
    expect(names).toContain('approvals');
    expect(names).toContain('user_memory');
```

Also add a second test in the same `describe` block:

```typescript
  it('executions table has project_id column', () => {
    const db = getDb();
    const cols = db.prepare("SELECT name FROM pragma_table_info('executions')").all() as { name: string }[];
    expect(cols.some(c => c.name === 'project_id')).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npm test -- db.test.ts`
Expected: FAIL — `expect(names).toContain('projects')` fails because the table doesn't exist yet.

- [ ] **Step 3: Replace the `workspaces` table with `projects`, add `user_settings`, and update `executions`**

In `server/src/db/index.ts`, inside the template string passed to `db.exec(...)` in `applySchema()`:

Replace the `workspaces` table definition with:

```sql
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      repo_path TEXT,
      enabled_connection_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      projects_root TEXT
    );
```

In the `executions` table definition, replace the `workspace_id` column:

```sql
    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      tool TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','done','error','awaiting_approval')),
      output_log TEXT NOT NULL DEFAULT '',
      result TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );
```

- [ ] **Step 4: Add a one-time migration for existing dev databases**

After the `db.exec(...)` call with the schema (after the existing column-migration blocks for `connections` and `sessions`), add:

```typescript
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  if (tableNames.some(t => t.name === 'workspaces')) {
    db.exec(`
      INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids, created_at)
      SELECT id, user_id, name, description, repo_path, enabled_connection_ids, created_at FROM workspaces
      WHERE NOT EXISTS (SELECT 1 FROM projects WHERE projects.id = workspaces.id);
    `);

    const executionCols = db.prepare("SELECT name FROM pragma_table_info('executions')").all() as { name: string }[];
    if (executionCols.some(c => c.name === 'workspace_id') && !executionCols.some(c => c.name === 'project_id')) {
      db.exec(`
        ALTER TABLE executions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
        UPDATE executions SET project_id = workspace_id;
      `);
    }

    db.exec('DROP TABLE workspaces');
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && npm test -- db.test.ts`
Expected: PASS

- [ ] **Step 6: Rename `DbWorkspace`/`getWorkspaceForUser` to project equivalents and add settings helpers**

At the bottom of `server/src/db/index.ts`, replace:

```typescript
export interface DbWorkspace {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string;
}

export function getWorkspaceForUser(workspaceId: string, userId: string): DbWorkspace | undefined {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM workspaces WHERE id = ? AND user_id = ?')
    .get(workspaceId, userId) as DbWorkspace | undefined;
}
```

with:

```typescript
export interface DbProject {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string;
}

export function getProjectForUser(projectId: string, userId: string): DbProject | undefined {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId) as DbProject | undefined;
}

export function getProjectsForUser(userId: string): DbProject[] {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE user_id = ?')
    .all(userId) as DbProject[];
}

export function getProjectsRoot(userId: string): string | null {
  const row = getDb()
    .prepare('SELECT projects_root FROM user_settings WHERE user_id = ?')
    .get(userId) as { projects_root: string | null } | undefined;
  return row?.projects_root ?? null;
}

export function setProjectsRoot(userId: string, projectsRoot: string): void {
  getDb()
    .prepare(`
      INSERT INTO user_settings (user_id, projects_root) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET projects_root = excluded.projects_root
    `)
    .run(userId, projectsRoot);
}
```

- [ ] **Step 7: Run the full server test suite to check for breakage from the renamed export**

Run: `cd server && npm test`
Expected: Several failures referencing `getWorkspaceForUser`, `DbWorkspace`, `/workspaces`, `workspace_id` — these are addressed in later tasks. Confirm `db.test.ts` itself passes.

- [ ] **Step 8: Commit**

```bash
git add server/src/db/index.ts server/tests/db.test.ts
git commit -m "feat(db): rename workspaces table to projects, add user_settings"
```

---

### Task 2: Project and settings API routes

**Files:**
- Create: `server/src/routes/projects.ts`
- Delete: `server/src/routes/workspaces.ts`
- Create: `server/src/routes/settings.ts`
- Modify: `server/src/index.ts`
- Create: `server/tests/projects.test.ts`
- Delete: `server/tests/workspaces.test.ts`
- Create: `server/tests/settings.test.ts`

- [ ] **Step 1: Write the failing test for the projects route**

Create `server/tests/projects.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';

let token: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `proj-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('projects', () => {
  let projectId: string;

  it('creates a project with a repo path', async () => {
    const res = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'api', description: 'My API project', enabled_connection_ids: [] });
    expect(res.status).toBe(201);
    projectId = res.body.id;
  });

  it('creates a project without a repo path', async () => {
    const res = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'notes', enabled_connection_ids: [] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it('lists projects with parsed enabled_connection_ids and nullable repo_path', async () => {
    const res = await request(app)
      .get('/projects')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body[0].enabled_connection_ids)).toBe(true);
    const notes = res.body.find((p: { name: string }) => p.name === 'notes');
    expect(notes.repo_path).toBeNull();
  });

  it('deletes a project', async () => {
    const res = await request(app)
      .delete(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
```

Delete `server/tests/workspaces.test.ts` (its coverage is fully replaced above).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npm test -- projects.test.ts`
Expected: FAIL — 404s, since `/projects` route doesn't exist yet.

- [ ] **Step 3: Create the projects route**

Create `server/src/routes/projects.ts` (adapted from the old `workspaces.ts`, `repo_path` already optional):

```typescript
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

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
  res.status(201).json({ id });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const result = getDb()
    .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(204).send();
});

export default router;
```

Delete `server/src/routes/workspaces.ts`.

- [ ] **Step 4: Wire the route into `index.ts`**

In `server/src/index.ts`, replace:

```typescript
import workspacesRoutes from './routes/workspaces.js';
```

with:

```typescript
import projectsRoutes from './routes/projects.js';
import settingsRoutes from './routes/settings.js';
```

and replace:

```typescript
app.use('/workspaces', workspacesRoutes);
```

with:

```typescript
app.use('/projects', projectsRoutes);
app.use('/settings', settingsRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && npm test -- projects.test.ts`
Expected: FAIL still — `/settings` route doesn't exist yet, but `index.ts` won't even compile/import without it. Continue to step 6 before re-running.

- [ ] **Step 6: Write the failing test for the settings route**

Create `server/tests/settings.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';

let token: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `settings-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('settings', () => {
  it('returns null projects_root by default', async () => {
    const res = await request(app)
      .get('/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.projects_root).toBeNull();
  });

  it('updates projects_root', async () => {
    const put = await request(app)
      .put('/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ projects_root: '/tmp/projects' });
    expect(put.status).toBe(200);

    const get = await request(app)
      .get('/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(get.body.projects_root).toBe('/tmp/projects');
  });
});
```

- [ ] **Step 7: Create the settings route**

Create `server/src/routes/settings.ts`:

```typescript
import { Router } from 'express';
import { getProjectsRoot, setProjectsRoot } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json({ projects_root: getProjectsRoot(userId) });
});

router.put('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { projects_root } = req.body as { projects_root?: string };
  if (!projects_root || !projects_root.trim()) { res.status(400).json({ error: 'projects_root required' }); return; }
  setProjectsRoot(userId, projects_root.trim());
  res.json({ projects_root: projects_root.trim() });
});

export default router;
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `cd server && npm test -- projects.test.ts settings.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/src/routes/projects.ts server/src/routes/settings.ts server/src/index.ts \
  server/tests/projects.test.ts server/tests/settings.test.ts
git rm server/src/routes/workspaces.ts server/tests/workspaces.test.ts
git commit -m "feat(api): rename workspaces routes to projects, add settings route"
```

---

### Task 3: Rename `workspace_id` → `project_id` in file, git, and graph-query tools

**Files:**
- Modify: `server/src/tools/file_ops.ts`
- Modify: `server/src/tools/git_op.ts`
- Create: `server/src/tools/project_query.ts`
- Delete: `server/src/tools/workspace_query.ts`
- Modify: `server/tests/tools/git_op.test.ts`
- Create: `server/tests/tools/project_query.test.ts` (if `workspace_query` had no test, this is new)

- [ ] **Step 1: Check for an existing `workspace_query` test**

Run: `find server/tests -iname '*workspace_query*'`
Expected: no results (confirmed during research — there is no existing test file for this tool).

- [ ] **Step 2: Update `file_ops.ts`**

Replace the entire contents of `server/src/tools/file_ops.ts`:

```typescript
import fs from 'fs/promises';
import path from 'path';
import { getProjectForUser } from '../db/index.js';
import { requestApproval } from '../services/executor.js';

interface ToolContext {
  userId: string;
  executionId: string;
  projectId: string;
}

function resolveInProject(repoPath: string, relPath: string): string {
  const resolved = path.resolve(repoPath, relPath);
  const repoResolved = path.resolve(repoPath);
  if (resolved !== repoResolved && !resolved.startsWith(repoResolved + path.sep)) {
    throw new Error('Path escapes project root');
  }
  return resolved;
}

function getRepoPath(projectId: string, userId: string): string {
  const project = getProjectForUser(projectId, userId);
  if (!project) throw new Error('Project not found');
  if (!project.repo_path) {
    throw new Error(`Project '${project.name}' has no repo. Create a new repo-backed project with create_project (with_repo=true) for this work.`);
  }
  return project.repo_path;
}

export async function readFile(input: { project_id: string; path: string }, ctx: ToolContext): Promise<string> {
  const repoPath = getRepoPath(input.project_id, ctx.userId);
  const target = resolveInProject(repoPath, input.path);
  return await fs.readFile(target, 'utf-8');
}

export async function listDir(input: { project_id: string; path?: string }, ctx: ToolContext): Promise<string> {
  const repoPath = getRepoPath(input.project_id, ctx.userId);
  const target = resolveInProject(repoPath, input.path ?? '.');
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n');
}

export async function writeFile(input: { project_id: string; path: string; content: string }, ctx: ToolContext): Promise<string> {
  const repoPath = getRepoPath(input.project_id, ctx.userId);
  const target = resolveInProject(repoPath, input.path);

  const decision = await requestApproval(ctx.executionId, ctx.userId, 'write_file', { path: input.path } as Record<string, unknown>, 'user');
  if (decision === 'rejected') return 'write_file cancelled';

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, input.content, 'utf-8');
  return `wrote ${input.content.length} bytes to ${input.path}`;
}
```

- [ ] **Step 3: Update `git_op.ts`'s `ToolContext`**

In `server/src/tools/git_op.ts`, replace:

```typescript
interface ToolContext {
  userId: string;
  executionId: string;
  workspaceId: string;
  repoPath: string;
}
```

with:

```typescript
interface ToolContext {
  userId: string;
  executionId: string;
  projectId: string;
  repoPath: string;
}
```

(`ctx.workspaceId` is not otherwise referenced inside this file — `repoPath` is what's used for git operations.)

- [ ] **Step 4: Update `git_op.test.ts`'s context fixture**

In `server/tests/tools/git_op.test.ts`, replace:

```typescript
const ctx = { userId: 'u1', executionId: 'e1', workspaceId: 'w1', repoPath: '/tmp/repo' };
```

with:

```typescript
const ctx = { userId: 'u1', executionId: 'e1', projectId: 'p1', repoPath: '/tmp/repo' };
```

- [ ] **Step 5: Run git_op tests**

Run: `cd server && npm test -- git_op.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for `project_query`**

Create `server/tests/tools/project_query.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runProjectQuery } from '../../src/tools/project_query.js';

vi.mock('../../src/services/graphify.js', () => ({
  queryGraph: vi.fn().mockResolvedValue('graph result'),
}));

vi.mock('../../src/db/index.js', () => ({
  getProjectForUser: vi.fn(),
}));

describe('project_query', () => {
  it('returns a message when the project has no repo', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectForUser).mockReturnValue({ id: 'p1', name: 'notes', description: null, repo_path: null, enabled_connection_ids: '[]' });

    const result = await runProjectQuery({ project_id: 'p1', question: 'what does this do?' }, 'u1');
    expect(result).toContain('no repo');
  });

  it('queries the graph when the project has a repo', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectForUser).mockReturnValue({ id: 'p1', name: 'api', description: null, repo_path: '/tmp/repo', enabled_connection_ids: '[]' });

    const result = await runProjectQuery({ project_id: 'p1', question: 'what does this do?' }, 'u1');
    expect(result).toBe('graph result');
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd server && npm test -- project_query.test.ts`
Expected: FAIL — `src/tools/project_query.js` does not exist.

- [ ] **Step 8: Create `project_query.ts` and delete `workspace_query.ts`**

Create `server/src/tools/project_query.ts`:

```typescript
import { queryGraph } from '../services/graphify.js';
import { getProjectForUser } from '../db/index.js';

interface ProjectQueryInput {
  project_id: string;
  question: string;
}

export async function runProjectQuery(input: ProjectQueryInput, userId: string): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);

  if (!project?.repo_path) {
    return 'Project has no repo path configured.';
  }

  return await queryGraph(project.repo_path, input.question);
}
```

Delete `server/src/tools/workspace_query.ts`.

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd server && npm test -- project_query.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add server/src/tools/file_ops.ts server/src/tools/git_op.ts server/src/tools/project_query.ts \
  server/tests/tools/git_op.test.ts server/tests/tools/project_query.test.ts
git rm server/src/tools/workspace_query.ts
git commit -m "refactor(tools): rename workspace_id to project_id, workspace_query to project_query"
```

---

### Task 4: Project management tools (`create_project`, `update_project`, `delete_project`)

**Files:**
- Create: `server/src/tools/project_ops.ts`
- Create: `server/tests/tools/project_ops.test.ts`
- Modify: `server/src/tools/definitions.ts`

- [ ] **Step 1: Write the failing tests for `project_ops`**

Create `server/tests/tools/project_ops.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createProject, updateProject, deleteProject } from '../../src/tools/project_ops.js';

const dbState = {
  projects: new Map<string, { id: string; user_id: string; name: string; description: string | null; repo_path: string | null }>(),
  projectsRoot: null as string | null,
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.startsWith('INSERT INTO projects')) {
          const [id, user_id, name, description, repo_path] = args as string[];
          dbState.projects.set(id, { id, user_id, name, description, repo_path });
        } else if (sql.startsWith('UPDATE projects SET description')) {
          const [description, id, user_id] = args as string[];
          const p = dbState.projects.get(id);
          if (p && p.user_id === user_id) p.description = description;
        } else if (sql.startsWith('DELETE FROM projects')) {
          const [id, user_id] = args as string[];
          const p = dbState.projects.get(id);
          if (p && p.user_id === user_id) dbState.projects.delete(id);
        }
        return { changes: 1 };
      },
      get: (...args: unknown[]) => {
        if (sql.startsWith('SELECT projects_root')) return { projects_root: dbState.projectsRoot };
        const [id, user_id] = args as string[];
        const p = dbState.projects.get(id);
        return p && p.user_id === user_id ? p : undefined;
      },
    }),
  }),
  getProjectForUser: (id: string, userId: string) => {
    const p = dbState.projects.get(id);
    return p && p.user_id === userId ? { ...p, enabled_connection_ids: '[]' } : undefined;
  },
  getProjectsRoot: (_userId: string) => dbState.projectsRoot,
}));

vi.mock('../../src/lib/ids.js', () => ({ newId: () => 'new-id' }));

vi.mock('../../src/services/executor.js', () => ({
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));

const userId = 'u1';
let tmpRoot: string;

beforeEach(() => {
  dbState.projects.clear();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-root-'));
  dbState.projectsRoot = tmpRoot;
});

describe('create_project', () => {
  it('creates a project without a repo', async () => {
    const result = await createProject({ name: 'Notes', with_repo: false }, userId, 'exec-1');
    expect(result).toContain('new-id');
    expect(dbState.projects.get('new-id')?.repo_path).toBeNull();
  });

  it('creates a project with a repo under projects_root', async () => {
    const result = await createProject({ name: 'My App', description: 'desc', with_repo: true }, userId, 'exec-1');
    expect(result).toContain('new-id');
    const repoPath = dbState.projects.get('new-id')?.repo_path;
    expect(repoPath).toBe(path.join(tmpRoot, 'my-app'));
    expect(fs.existsSync(path.join(repoPath!, '.git'))).toBe(true);
  });

  it('errors when projects_root is unset and with_repo is true', async () => {
    dbState.projectsRoot = null;
    const result = await createProject({ name: 'My App', with_repo: true }, userId, 'exec-1');
    expect(result).toContain('projects_root');
  });
});

describe('update_project', () => {
  it('updates the description', async () => {
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: 'old', repo_path: null });
    const result = await updateProject({ project_id: 'p1', description: 'new desc' }, userId);
    expect(result).toContain('updated');
    expect(dbState.projects.get('p1')?.description).toBe('new desc');
  });
});

describe('delete_project', () => {
  it('removes the project record without deleting files when delete_files is false', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-repo-'));
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null, repo_path: repoDir });

    const result = await deleteProject({ project_id: 'p1', delete_files: false }, userId, 'exec-1');

    expect(result).toContain('deleted');
    expect(dbState.projects.has('p1')).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(true);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('removes the project record and deletes files when delete_files is true', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-repo-'));
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null, repo_path: repoDir });

    const result = await deleteProject({ project_id: 'p1', delete_files: true }, userId, 'exec-1');

    expect(result).toContain('deleted');
    expect(dbState.projects.has('p1')).toBe(false);
    expect(fs.existsSync(repoDir)).toBe(false);
  });

  it('returns a cancellation message when the user rejects', async () => {
    const { requestApproval } = await import('../../src/services/executor.js');
    vi.mocked(requestApproval).mockResolvedValueOnce('rejected');
    dbState.projects.set('p1', { id: 'p1', user_id: userId, name: 'api', description: null, repo_path: null });

    const result = await deleteProject({ project_id: 'p1', delete_files: false }, userId, 'exec-1');

    expect(result).toContain('cancelled');
    expect(dbState.projects.has('p1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npm test -- project_ops.test.ts`
Expected: FAIL — `src/tools/project_ops.js` does not exist.

- [ ] **Step 3: Implement `project_ops.ts`**

Create `server/src/tools/project_ops.ts`:

```typescript
import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import { getDb, getProjectForUser, getProjectsRoot } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requestApproval } from '../services/executor.js';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'project';
}

export async function createProject(
  input: { name: string; description?: string; with_repo: boolean },
  userId: string,
  _executionId: string
): Promise<string> {
  let repoPath: string | null = null;

  if (input.with_repo) {
    const root = getProjectsRoot(userId);
    if (!root) {
      return 'Error: projects_root is not set. Ask the user to set a Projects root in Settings before creating repo-backed projects.';
    }
    repoPath = path.join(root, slugify(input.name));
    try {
      await fs.access(repoPath);
      return `Error: directory already exists at ${repoPath}`;
    } catch {
      // does not exist, proceed
    }
    await fs.mkdir(repoPath, { recursive: true });
    await simpleGit().cwd(repoPath).init();
  }

  const id = newId();
  getDb()
    .prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
    .run(id, userId, input.name, input.description ?? null, repoPath, '[]');

  return `Created project '${input.name}' (id: ${id})${repoPath ? ` with repo at ${repoPath}` : ' with no repo'}`;
}

export async function updateProject(
  input: { project_id: string; description?: string },
  userId: string
): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);
  if (!project) return `Error: project ${input.project_id} not found`;

  if (input.description !== undefined) {
    getDb()
      .prepare('UPDATE projects SET description = ? WHERE id = ? AND user_id = ?')
      .run(input.description, input.project_id, userId);
  }

  return `Project '${project.name}' updated`;
}

export async function deleteProject(
  input: { project_id: string; delete_files: boolean },
  userId: string,
  executionId: string
): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);
  if (!project) return `Error: project ${input.project_id} not found`;

  const decision = await requestApproval(
    executionId,
    userId,
    'delete_project',
    { project_id: input.project_id, name: project.name, repo_path: project.repo_path, delete_files: input.delete_files },
    'user'
  );
  if (decision === 'rejected') return 'delete_project cancelled';

  getDb()
    .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
    .run(input.project_id, userId);

  if (input.delete_files && project.repo_path) {
    await fs.rm(project.repo_path, { recursive: true, force: true });
  }

  return `Project '${project.name}' deleted${input.delete_files && project.repo_path ? ' (files removed)' : ''}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npm test -- project_ops.test.ts`
Expected: PASS

- [ ] **Step 5: Add tool definitions**

In `server/src/tools/definitions.ts`, add three new entries to the `toolDefinitions` array (placed after the `recall` definition, before `read_file`):

```typescript
  {
    name: 'create_project',
    description: 'Create a new project. If with_repo is true, creates a git repo under the configured projects root.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name' },
        description: { type: 'string', description: 'Optional description' },
        with_repo: { type: 'boolean', description: 'Whether to create a backing git repo for this project' },
      },
      required: ['name', 'with_repo'],
    },
  },
  {
    name: 'update_project',
    description: "Update a project's description.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['project_id', 'description'],
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project. Requires user approval. Optionally deletes the project files on disk.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        delete_files: { type: 'boolean', description: 'Whether to also delete the project repo directory from disk' },
      },
      required: ['project_id', 'delete_files'],
    },
  },
```

Also rename every `workspace_id` property to `project_id` in the existing definitions for `invoke_claude_code`, `invoke_codex`, `git_op`, `workspace_query` (and rename that tool's `name` to `project_query`), `read_file`, `list_dir`, and `write_file`.

For the `project_query` definition specifically, replace:

```typescript
  {
    name: 'workspace_query',
    description: 'Query the Graphify knowledge graph for a workspace to understand its code structure without reading raw files.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        question: { type: 'string', description: 'What to look up in the codebase' },
      },
      required: ['workspace_id', 'question'],
    },
  },
```

with:

```typescript
  {
    name: 'project_query',
    description: 'Query the Graphify knowledge graph for a project to understand its code structure without reading raw files.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        question: { type: 'string', description: 'What to look up in the codebase' },
      },
      required: ['project_id', 'question'],
    },
  },
```

- [ ] **Step 6: Run the full server test suite**

Run: `cd server && npm test`
Expected: Failures remain only in `agent.test.ts` (and possibly type errors referencing `agent.ts`/`executor.ts`), addressed in Task 5.

- [ ] **Step 7: Commit**

```bash
git add server/src/tools/project_ops.ts server/src/tools/definitions.ts server/tests/tools/project_ops.test.ts
git commit -m "feat(tools): add create_project, update_project, delete_project tools"
```

---

### Task 5: Wire project tools into the agent, update system prompt and executor

**Files:**
- Modify: `server/src/services/agent.ts`
- Modify: `server/src/services/executor.ts`
- Modify: `server/src/routes/executions.ts`
- Modify: `server/tests/services/agent.test.ts`
- Modify: `server/tests/services/executor.test.ts` (if it references `workspaceId`)

- [ ] **Step 1: Check `executor.test.ts` for `workspaceId` references**

Run: `grep -n "workspaceId\|workspace_id" server/tests/services/executor.test.ts`

If matches are found, rename them to `projectId`/`project_id` to match Step 2 below. (If no matches, skip — the param is positional.)

- [ ] **Step 2: Rename `createExecution`'s parameter in `executor.ts`**

In `server/src/services/executor.ts`, replace:

```typescript
export function createExecution(
  userId: string,
  messageId: string,
  workspaceId: string | null,
  tool: string
): string {
  const id = newId();
  getDb()
    .prepare('INSERT INTO executions (id, message_id, workspace_id, tool, status) VALUES (?,?,?,?,?)')
    .run(id, messageId, workspaceId, tool, 'running');
```

with:

```typescript
export function createExecution(
  userId: string,
  messageId: string,
  projectId: string | null,
  tool: string
): string {
  const id = newId();
  getDb()
    .prepare('INSERT INTO executions (id, message_id, project_id, tool, status) VALUES (?,?,?,?,?)')
    .run(id, messageId, projectId, tool, 'running');
```

- [ ] **Step 3: Update the SQL column reference in `executions.ts`**

In `server/src/routes/executions.ts`, in the `GET /:id` query, replace `e.workspace_id` with `e.project_id`.

- [ ] **Step 4: Write/update the failing test for the new system prompt content**

In `server/tests/services/agent.test.ts`, after the existing `beforeAll` block, add a project fixture and a new test. First check the end of the existing test file to see where assertions on `system` (if any) live:

Run: `grep -n "system\|projects\|workspaces" server/tests/services/agent.test.ts`

Add this test to the `describe` block (create one if none exists), inserting a project row before invoking `runAgentTurn`:

```typescript
  it('includes available projects and project tools in the system prompt', async () => {
    const db = getDb();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(newId(), userId, 'demo', 'Demo project', null, '[]');

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'hi');

    await runAgentTurn(userId, sessionId, msgId);

    const call = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    expect(call.system).toContain('Available projects');
    expect(call.system).toContain('demo');
    expect(call.tools.some((t: { name: string }) => t.name === 'create_project')).toBe(true);
    expect(call.tools.some((t: { name: string }) => t.name === 'delete_project')).toBe(true);
  });
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd server && npm test -- agent.test.ts`
Expected: FAIL — `call.system` still says "Available workspaces" / "No workspaces configured", and the new tools aren't in `toolDefinitions` dispatch yet (they were added to definitions in Task 4, so the tools list assertion may already pass — but the prompt text assertion fails).

- [ ] **Step 6: Update `buildSystemPrompt` and `getWorkspaces` in `agent.ts`**

In `server/src/services/agent.ts`, replace the imports for `getWorkspaceForUser`/`DbWorkspace` with `getProjectForUser`/`DbProject`, and `getProjectsRoot` is not needed here (used in `project_ops.ts`).

Replace:

```typescript
import { getDb, getWorkspaceForUser, type DbWorkspace } from '../db/index.js';
```

with:

```typescript
import { getDb, getProjectForUser, type DbProject } from '../db/index.js';
```

Replace:

```typescript
function getWorkspaces(userId: string): DbWorkspace[] {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM workspaces WHERE user_id = ?')
    .all(userId) as DbWorkspace[];
}

function buildSystemPrompt(userId: string): string {
  const memory = recallAll(userId);
  const workspaces = getWorkspaces(userId);
  const memoryText = Object.keys(memory).length > 0
    ? `\n\nUser memory:\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';
  const wsText = workspaces.length > 0
    ? `\n\nAvailable workspaces:\n${workspaces.map(w => `- ${w.name} (id: ${w.id})${w.description ? ': ' + w.description : ''}`).join('\n')}`
    : '\n\nNo workspaces configured yet.';

  return `You are a personal AI operator. You help the user plan, execute, and manage work across their projects and tools.

When the user gives you a task, determine which workspace it relates to (ask if unclear), then use the available tools to complete it. For coding work, prefer invoke_claude_code or invoke_codex over manual file edits. Query workspace_query before dispatching coding tools to understand the codebase structure.

You can run tools in parallel when the tasks are independent.

Approval tiers:
- Agent-approved (automatic, logged): invoke_claude_code, invoke_codex, git commit
- User-approved (pauses for user): git push, github write ops, write_file
Never skip a write op because approval is needed — just proceed and the system handles it.
${memoryText}
${wsText}`;
}
```

with:

```typescript
function getProjects(userId: string): DbProject[] {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE user_id = ?')
    .all(userId) as DbProject[];
}

function buildSystemPrompt(userId: string): string {
  const memory = recallAll(userId);
  const projects = getProjects(userId);
  const memoryText = Object.keys(memory).length > 0
    ? `\n\nUser memory:\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';
  const projectsText = projects.length > 0
    ? `\n\nAvailable projects:\n${projects.map(p => `- ${p.name} (id: ${p.id}${p.repo_path ? '' : ', no repo'})${p.description ? ': ' + p.description : ''}`).join('\n')}`
    : '\n\nNo projects yet.';

  return `You are a personal AI operator. You help the user plan, execute, and manage work across their projects and tools.

When the user gives you a task, determine which project it relates to. If no existing project fits and the task implies new code or files, call create_project yourself (pick a sensible name and description) rather than asking the user where to put things — only ask if it's genuinely ambiguous which existing project a task belongs to. For coding work, prefer invoke_claude_code or invoke_codex over manual file edits. Query project_query before dispatching coding tools to understand the codebase structure.

You can run tools in parallel when the tasks are independent.

Approval tiers:
- Agent-approved (automatic, logged): invoke_claude_code, invoke_codex, git commit, create_project, update_project
- User-approved (pauses for user): git push, github write ops, write_file, delete_project
Never skip a write op because approval is needed — just proceed and the system handles it.
${memoryText}
${projectsText}`;
}
```

- [ ] **Step 7: Add dispatch cases for the new tools and rename `workspace_id` lookups**

In `server/src/services/agent.ts`, in `dispatchTool`:

Replace:

```typescript
  const workspaceId = (toolInput.workspace_id as string | undefined) ?? 'unknown';
  const ws = getWorkspaceForUser(workspaceId, userId);
  const executionId = createExecution(userId, messageId, ws?.id ?? null, toolName);
```

with:

```typescript
  const projectId = (toolInput.project_id as string | undefined) ?? 'unknown';
  const project = getProjectForUser(projectId, userId);
  const executionId = createExecution(userId, messageId, project?.id ?? null, toolName);
```

Then update every reference to `ws` in the `switch` to `project`, and every `workspaceId`/`workspace_id` passed into tool calls to `projectId`/`project_id`. Specifically:

- `invoke_claude_code` and `invoke_codex` cases: `ws?.enabled_connection_ids` → `project?.enabled_connection_ids`, `ws?.repo_path` → `project?.repo_path`.
- `git_op` case: change

```typescript
      case 'git_op': {
        result = await runGitOp(
          { op: toolInput.op as 'log' | 'diff' | 'status' | 'commit' | 'push', message: toolInput.message as string | undefined },
          { userId, executionId, workspaceId, repoPath: ws?.repo_path ?? '/tmp' }
        );
        break;
      }
```

to:

```typescript
      case 'git_op': {
        result = await runGitOp(
          { op: toolInput.op as 'log' | 'diff' | 'status' | 'commit' | 'push', message: toolInput.message as string | undefined },
          { userId, executionId, projectId, repoPath: project?.repo_path ?? '/tmp' }
        );
        break;
      }
```

- `workspace_query` case: rename to `project_query` and call `runProjectQuery`:

```typescript
      case 'project_query':
        result = await runProjectQuery({ project_id: projectId, question: toolInput.question as string }, userId);
        break;
```

(update the import from `runWorkspaceQuery`/`'../tools/workspace_query.js'` to `runProjectQuery`/`'../tools/project_query.js'`)

- `read_file`, `list_dir`, `write_file` cases: change the input object's `workspace_id: workspaceId` to `project_id: projectId`, and `ToolContext` literals from `{ userId, executionId, workspaceId }` to `{ userId, executionId, projectId }`.

- Add three new cases (e.g. after `recall`):

```typescript
      case 'create_project':
        result = await createProject(
          { name: toolInput.name as string, description: toolInput.description as string | undefined, with_repo: toolInput.with_repo as boolean },
          userId,
          executionId
        );
        break;
      case 'update_project':
        result = await updateProject({ project_id: toolInput.project_id as string, description: toolInput.description as string }, userId);
        break;
      case 'delete_project':
        result = await deleteProject({ project_id: toolInput.project_id as string, delete_files: toolInput.delete_files as boolean }, userId, executionId);
        break;
```

Add the import:

```typescript
import { createProject, updateProject, deleteProject } from '../tools/project_ops.js';
```

- [ ] **Step 8: Run the agent test**

Run: `cd server && npm test -- agent.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full server test suite**

Run: `cd server && npm test`
Expected: PASS (all suites)

- [ ] **Step 10: Commit**

```bash
git add server/src/services/agent.ts server/src/services/executor.ts server/src/routes/executions.ts \
  server/tests/services/agent.test.ts server/tests/services/executor.test.ts
git commit -m "feat(agent): wire create/update/delete project tools, rename workspace to project in prompt and dispatch"
```

---

### Task 6: Frontend types and API client rename

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Update `types.ts`**

In `web/src/types.ts`, replace:

```typescript
export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string[];
}
```

with:

```typescript
export interface Project {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string[];
}

export interface UserSettings {
  projects_root: string | null;
}
```

Also in the `Execution` interface, rename `workspace_id: string;` to `project_id: string;`, and in `WSExecutionUpdate`, rename `workspaceName?: string;` to `projectName?: string;`.

- [ ] **Step 2: Update `api.ts`**

In `web/src/lib/api.ts`:

Replace the import:

```typescript
import type { Session, Message, Workspace, Connection, EffortLevel, ClaudeModelInfo } from '../types.js';
```

with:

```typescript
import type { Session, Message, Project, Connection, EffortLevel, ClaudeModelInfo, UserSettings } from '../types.js';
```

Replace:

```typescript
export function getWorkspaces(): Promise<Workspace[]> {
  return request('/workspaces');
}

export function createWorkspace(body: { name: string; description?: string; repo_path?: string; enabled_connection_ids: string[] }): Promise<{ id: string }> {
  return request('/workspaces', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteWorkspace(id: string): Promise<void> {
  return request(`/workspaces/${id}`, { method: 'DELETE' });
}
```

with:

```typescript
export function getProjects(): Promise<Project[]> {
  return request('/projects');
}

export function createProject(body: { name: string; description?: string; repo_path?: string; enabled_connection_ids: string[] }): Promise<{ id: string }> {
  return request('/projects', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteProject(id: string): Promise<void> {
  return request(`/projects/${id}`, { method: 'DELETE' });
}

export function getSettings(): Promise<UserSettings> {
  return request('/settings');
}

export function updateSettings(body: { projects_root: string }): Promise<UserSettings> {
  return request('/settings', { method: 'PUT', body: JSON.stringify(body) });
}
```

- [ ] **Step 3: Search for remaining `Workspace`/`getWorkspaces` references**

Run: `grep -rn "Workspace\|getWorkspaces\|createWorkspace\|deleteWorkspace" web/src`
Expected: matches only in `NavPanel.tsx`, `Settings.tsx`, `AppLayout.tsx`, `IconRail.tsx` — these are addressed in Task 7.

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts web/src/lib/api.ts
git commit -m "refactor(web): rename Workspace types and API client functions to Project"
```

---

### Task 7: Frontend UI rename and Projects-root setting

**Files:**
- Modify: `web/src/components/IconRail.tsx`
- Modify: `web/src/components/NavPanel.tsx`
- Modify: `web/src/pages/AppLayout.tsx`
- Modify: `web/src/pages/Settings.tsx`

- [ ] **Step 1: Update `IconRail.tsx`**

In `web/src/components/IconRail.tsx`, replace the `'workspaces'` literal type with `'projects'` in the `IconRailProps` interface (`activePanel: 'sessions' | 'workspaces' | null` → `'sessions' | 'projects' | null`, and `onPanelToggle: (panel: 'sessions' | 'workspaces') => void` → `'sessions' | 'projects'`), and change the `title="Workspaces"` / `onClick={() => onPanelToggle('workspaces')}` to `title="Projects"` / `onClick={() => onPanelToggle('projects')}`. Update the `{/* Workspaces */}` comment to `{/* Projects */}`.

- [ ] **Step 2: Update `AppLayout.tsx`**

In `web/src/pages/AppLayout.tsx`, replace both occurrences of the `'sessions' | 'workspaces'` type union with `'sessions' | 'projects'` (in the `useState` and `handlePanelToggle` signature).

- [ ] **Step 3: Update `NavPanel.tsx`**

In `web/src/components/NavPanel.tsx`:

- Replace the import `import { getWorkspaces, getConnections } from '../lib/api.js';` and `import type { Session, Workspace, Connection } from '../types.js';` with `import { getProjects, getConnections } from '../lib/api.js';` and `import type { Session, Project, Connection } from '../types.js';`.
- Replace the `NavPanelProps` interface's `activePanel: 'sessions' | 'workspaces';` with `activePanel: 'sessions' | 'projects';`.
- Replace the `workspaces` query:

```typescript
  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: getWorkspaces,
    enabled: activePanel === 'workspaces',
  });
```

with:

```typescript
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    enabled: activePanel === 'projects',
  });
```

- Replace `enabled: activePanel === 'workspaces'` in the `connections` query with `enabled: activePanel === 'projects'`.
- In the JSX branch for `activePanel === 'sessions' ? (...) : (...)`, replace the "Workspaces" panel body:

```tsx
          <div className="px-4 py-4">
            <div className="text-sm font-medium">Workspaces</div>
            <div className="text-xs text-muted-foreground">{workspaces.length} configured</div>
          </div>
          <Separator className="mx-4 w-auto bg-border/60" />
          <ScrollArea className="flex-1">
            <div className="p-2.5">
            {workspaces.map(w => (
              <div key={w.id} className="rounded-2xl px-3 py-2.5 hover:bg-background/65">
                <div className="truncate text-sm font-medium">
                  {w.name}
                </div>
                {w.description && (
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {w.description}
                  </div>
                )}
              </div>
            ))}
            {workspaces.length > 0 && connections.length > 0 && (
```

with:

```tsx
          <div className="px-4 py-4">
            <div className="text-sm font-medium">Projects</div>
            <div className="text-xs text-muted-foreground">{projects.length} total</div>
          </div>
          <Separator className="mx-4 w-auto bg-border/60" />
          <ScrollArea className="flex-1">
            <div className="p-2.5">
            {projects.map(p => (
              <div key={p.id} className="rounded-2xl px-3 py-2.5 hover:bg-background/65">
                <div className="truncate text-sm font-medium">
                  {p.name}
                  {!p.repo_path && <span className="ml-2 text-xs text-muted-foreground">(no repo)</span>}
                </div>
                {p.description && (
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {p.description}
                  </div>
                )}
              </div>
            ))}
            {projects.length > 0 && connections.length > 0 && (
```

- [ ] **Step 4: Update `Settings.tsx` imports and queries**

In `web/src/pages/Settings.tsx`, replace the import block:

```typescript
import {
  createConnection,
  createWorkspace,
  deleteConnection,
  deleteWorkspace,
  getConnections,
  getMemory,
  getWorkspaces,
} from '../lib/api.js';
import { clearToken } from '../lib/auth.js';
import type { Connection, Workspace } from '../types.js';
```

with:

```typescript
import {
  createConnection,
  createProject,
  deleteConnection,
  deleteProject,
  getConnections,
  getMemory,
  getProjects,
  getSettings,
  updateSettings,
} from '../lib/api.js';
import { clearToken } from '../lib/auth.js';
import type { Connection, Project, UserSettings } from '../types.js';
```

Replace:

```typescript
  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const { data: workspaces = [] } = useQuery<Workspace[]>({ queryKey: ['workspaces'], queryFn: getWorkspaces });
  const { data: memory = {} } = useQuery<Record<string, string>>({ queryKey: ['memory'], queryFn: getMemory });
```

with:

```typescript
  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['projects'], queryFn: getProjects });
  const { data: memory = {} } = useQuery<Record<string, string>>({ queryKey: ['memory'], queryFn: getMemory });
  const { data: settings } = useQuery<UserSettings>({ queryKey: ['settings'], queryFn: getSettings });
```

- [ ] **Step 5: Rename workspace state, mutations, and modal handlers**

Replace:

```typescript
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsDesc, setWsDesc] = useState('');
  const [wsRepo, setWsRepo] = useState('');
  const [wsConnIds, setWsConnIds] = useState<string[]>([]);
  const [wsError, setWsError] = useState('');
```

with:

```typescript
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [projRepo, setProjRepo] = useState('');
  const [projConnIds, setProjConnIds] = useState<string[]>([]);
  const [projError, setProjError] = useState('');
  const [projectsRoot, setProjectsRoot] = useState('');
  const [projectsRootError, setProjectsRootError] = useState('');
```

Replace:

```typescript
  const workspaceConnections = connections.filter(c => c.purpose !== 'lead_agent');
```

with:

```typescript
  const projectConnections = connections.filter(c => c.purpose !== 'lead_agent');
```

Replace:

```typescript
  const createWsMutation = useMutation({
    mutationFn: () => createWorkspace({
      name: wsName,
      description: wsDesc || undefined,
      repo_path: wsRepo || undefined,
      enabled_connection_ids: wsConnIds,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      closeWorkspaceModal();
    },
    onError: (e: Error) => setWsError(e.message),
  });

  const deleteWsMutation = useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspaces'] }),
  });
```

with:

```typescript
  const createProjMutation = useMutation({
    mutationFn: () => createProject({
      name: projName,
      description: projDesc || undefined,
      repo_path: projRepo || undefined,
      enabled_connection_ids: projConnIds,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      closeProjectModal();
    },
    onError: (e: Error) => setProjError(e.message),
  });

  const deleteProjMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const updateSettingsMutation = useMutation({
    mutationFn: () => updateSettings({ projects_root: projectsRoot }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e: Error) => setProjectsRootError(e.message),
  });
```

Replace:

```typescript
  function openWorkspaceModal() {
    setShowWorkspaceModal(true);
    setWsName('');
    setWsDesc('');
    setWsRepo('');
    setWsConnIds([]);
    setWsError('');
  }

  function closeWorkspaceModal() {
    setShowWorkspaceModal(false);
    setWsName('');
    setWsDesc('');
    setWsRepo('');
    setWsConnIds([]);
    setWsError('');
  }
```

with:

```typescript
  function openProjectModal() {
    setShowProjectModal(true);
    setProjName('');
    setProjDesc('');
    setProjRepo('');
    setProjConnIds([]);
    setProjError('');
  }

  function closeProjectModal() {
    setShowProjectModal(false);
    setProjName('');
    setProjDesc('');
    setProjRepo('');
    setProjConnIds([]);
    setProjError('');
  }
```

Add an effect to seed `projectsRoot` from `settings` once loaded — near the top of the component, after the `useState` declarations:

```typescript
  useEffect(() => {
    if (settings?.projects_root) setProjectsRoot(settings.projects_root);
  }, [settings]);
```

Add `useEffect` to the React import at the top of the file: change `import { useState } from 'react';` to `import { useState, useEffect } from 'react';`.

- [ ] **Step 6: Rename the `WorkspaceModal` component and its references**

Replace the `WorkspaceModal` function (rename to `ProjectModal`), updating all `ws*`/`Workspace` identifiers used inside it to their `proj*`/`Project` equivalents (`showWorkspaceModal`→`showProjectModal`, `closeWorkspaceModal`→`closeProjectModal`, `wsName`→`projName`, `setWsName`→`setProjName`, `wsDesc`→`projDesc`, `setWsDesc`→`setProjDesc`, `wsRepo`→`projRepo`, `setWsRepo`→`setProjRepo`, `workspaceConnections`→`projectConnections`, `wsConnIds`→`projConnIds`, `setWsConnIds`→`setProjConnIds`, `wsError`→`projError`, `createWsMutation`→`createProjMutation`, `Modal title="Workspace"`→`Modal title="Project"`, `Save workspace`→`Save project`, `placeholder="Main app"` stays):

```tsx
  function ProjectModal() {
    if (!showProjectModal) return null;
    return (
      <Modal title="Project" onClose={closeProjectModal}>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Name</Label>
            <Input placeholder="Main app" value={projName} onChange={e => setProjName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>Description</Label>
            <Input placeholder="Optional" value={projDesc} onChange={e => setProjDesc(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>Repo path (optional)</Label>
            <Input placeholder="/Users/you/project" value={projRepo} onChange={e => setProjRepo(e.target.value)} className={inputCls} />
          </div>
          {projectConnections.length > 0 && (
            <div>
              <Label>Allowed tools</Label>
              <div className="mt-2 rounded-xl border bg-card px-3 py-2">
                {projectConnections.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={projConnIds.includes(c.id)}
                      onChange={e => setProjConnIds(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))}
                      className="h-4 w-4 rounded border-border bg-background accent-primary"
                    />
                    <span className="text-sm text-foreground/70">{c.name}</span>
                    <Badge variant="outline">{purposeLabel(c.purpose)}</Badge>
                  </label>
                ))}
              </div>
            </div>
          )}
          {projError && <div className="text-destructive text-sm">{projError}</div>}
          <DialogFooter>
            <button onClick={closeProjectModal} className={ghostBtn}>Cancel</button>
            <button onClick={() => createProjMutation.mutate()} className={primaryBtn} disabled={!projName.trim()}>Save project</button>
          </DialogFooter>
        </div>
      </Modal>
    );
  }
```

- [ ] **Step 7: Rename the "Workspaces" section and add the Projects-root field**

Replace:

```tsx
      <Section title="Workspaces">
        {workspaces.length > 0 && (
          <div className="mb-3 grid gap-2">
            {workspaces.map(w => (
              <div key={w.id} className={rowCls}>
                <div className="flex-1">
                  <div className="text-sm font-medium">{w.name}</div>
                  {w.description && <div className="text-muted-foreground/70 text-xs mt-0.5">{w.description}</div>}
                </div>
                <DeleteBtn onClick={() => deleteWsMutation.mutate(w.id)} />
              </div>
            ))}
          </div>
        )}
        <button onClick={openWorkspaceModal} className={primaryBtn}>Add workspace</button>
      </Section>
```

with:

```tsx
      <Section title="Projects">
        <div className="mb-3 flex items-end gap-3">
          <div className="flex-1">
            <Label>Projects root</Label>
            <Input
              placeholder="/Users/you/projects"
              value={projectsRoot}
              onChange={e => setProjectsRoot(e.target.value)}
              className={inputCls}
            />
          </div>
          <button onClick={() => updateSettingsMutation.mutate()} className={ghostBtn} disabled={!projectsRoot.trim()}>
            Save
          </button>
        </div>
        {projectsRootError && <div className="text-destructive text-sm mb-3">{projectsRootError}</div>}
        <p className="text-muted-foreground/70 text-xs mb-3">
          The agent creates new repo-backed projects under this directory.
        </p>
        {projects.length > 0 && (
          <div className="mb-3 grid gap-2">
            {projects.map(p => (
              <div key={p.id} className={rowCls}>
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {p.name}
                    {!p.repo_path && <span className="ml-2 text-muted-foreground/70 text-xs">(no repo)</span>}
                  </div>
                  {p.description && <div className="text-muted-foreground/70 text-xs mt-0.5">{p.description}</div>}
                </div>
                <DeleteBtn onClick={() => deleteProjMutation.mutate(p.id)} />
              </div>
            ))}
          </div>
        )}
        <button onClick={openProjectModal} className={primaryBtn}>Add project</button>
      </Section>
```

- [ ] **Step 8: Update the final JSX to render `ProjectModal`**

Replace `<WorkspaceModal />` with `<ProjectModal />` near the bottom of the component's return statement.

- [ ] **Step 9: Search for any leftover `workspace`/`Workspace`/`ws` references**

Run: `grep -rni "workspace" web/src`
Expected: no remaining matches (apart from unrelated text like "Open your local agent workspace." in `Login.tsx`, which is fine to leave — it's generic copy, not a code reference).

- [ ] **Step 10: Start the dev servers and manually verify in the browser**

Run (from `server/`): `npm run dev` (if not already running)
Run (from `web/`): `npm run dev`

Using Playwright (or the browser), navigate to `http://localhost:5173`, open the "Projects" panel via the icon rail, go to Settings, set a "Projects root" (e.g. `/tmp/agent-projects`), save it, then add a project both with and without a repo path, and confirm both appear with correct "(no repo)" labeling. Delete one to confirm the delete button still works.

- [ ] **Step 11: Run the full test suites**

Run: `cd server && npm test && cd ../web && npm test`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add web/src/components/IconRail.tsx web/src/components/NavPanel.tsx web/src/pages/AppLayout.tsx web/src/pages/Settings.tsx
git commit -m "feat(web): rename Workspaces UI to Projects, add projects root setting"
```

---

## Spec coverage check

- Rename `workspaces` → `projects`, nullable `repo_path` → Task 1, 2, 6, 7
- `user_settings.projects_root`, Settings UI field → Task 1, 2, 7
- `create_project` (agent-approved, slug under `projects_root`, git init) → Task 4, 5
- `update_project` (description only, agent-approved) → Task 4, 5
- `delete_project` (user-approved, optional file deletion) → Task 4, 5
- Existing tools' `workspace_id` → `project_id`, `workspace_query` → `project_query`, no-repo error message → Task 3
- System prompt: "Available projects", create-on-demand guidance, approval tiers updated → Task 5
- API routes `/workspaces` → `/projects`, `executions.workspace_id` → `project_id` → Task 1, 2, 5
- Frontend rename throughout → Task 6, 7

Out of scope per spec: graphify indexing, structured memory, renaming projects / changing `repo_path` via agent tools, multi-tier approval for edits — none of the tasks above implement these.
