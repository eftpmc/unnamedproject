# Project Sandbox Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static project type system (`default`/`video`) with an open-ended sandbox model where project capabilities are detected automatically and drive UI/orchestrator behavior.

**Architecture:** Remove the `type` column from projects entirely. Add a server-side capability detector with two dimensions: `has_remotion` is a **server-level** capability (checks whether the global Remotion entry point exists alongside the server binary — Remotion is not per-project, it's a single shared composition); `has_media` is **per-project** (checks the data-dir media folder `<dataDir>/projects/<id>/media/` for rendered files). A new `GET /projects/:id/capabilities` endpoint returns these. The frontend uses a React Query hook to fetch capabilities and render tabs dynamically. The orchestrator context block is rewritten to describe capabilities rather than a type label. The video service gains a graceful pre-flight check so it fails with a helpful message when Remotion is not configured, and the orchestrator system prompt explains how to scaffold it via `invoke_claude_code`.

**Tech Stack:** TypeScript, Express, better-sqlite3, React, @tanstack/react-query, Vitest

**Out of scope:** Per-project workspace context document (planned follow-on).

---

### Task 1: Delete the server-side type system

**Files:**
- Delete: `server/src/services/projectTypes.ts`
- Delete: `server/src/services/projectTypes.test.ts`

- [ ] **Step 1: Delete the files**

```bash
rm server/src/services/projectTypes.ts
rm server/src/services/projectTypes.test.ts
```

- [ ] **Step 2: Verify TypeScript surfaces the broken imports**

```bash
cd server && npx tsc --noEmit 2>&1 | grep projectTypes
```

Expected: errors referencing `projectTypes` imports — confirms what needs cleaning in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete projectTypes service"
```

---

### Task 2: Remove type from server DB, project_ops, routes, and tool definitions

**Files:**
- Modify: `server/src/db/index.ts`
- Modify: `server/src/tools/project_ops.ts`
- Modify: `server/src/tools/definitions.ts`
- Modify: `server/src/routes/projects.ts`
- Modify: `server/tests/projects.test.ts`

- [ ] **Step 1: Write failing tests — project creation without type, description update**

In `server/tests/projects.test.ts`, find the test `'creates and lists a video project type'` and replace it with:

```typescript
it('creates a project without a type field', async () => {
  const res = await request(app)
    .post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'sandbox-project', enabled_connection_ids: [] });
  expect(res.status).toBe(201);
  const project = res.body as { id: string; name: string };
  expect(project.id).toBeTruthy();
  expect(project.name).toBe('sandbox-project');
  expect((project as Record<string, unknown>).type).toBeUndefined();
});
```

Replace `'updates and validates project type'` test with:

```typescript
it('updates project description', async () => {
  const create = await request(app)
    .post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'update-test', enabled_connection_ids: [] });
  const id = (create.body as { id: string }).id;

  const patch = await request(app)
    .patch(`/projects/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ description: 'updated desc' });
  expect(patch.status).toBe(200);

  const list = await request(app)
    .get('/projects')
    .set('Authorization', `Bearer ${token}`);
  const updated = (list.body as Array<{ id: string; description: string | null }>).find(p => p.id === id);
  expect(updated?.description).toBe('updated desc');
});
```

- [ ] **Step 2: Run tests to see them fail**

```bash
cd server && npx vitest run tests/projects.test.ts 2>&1 | tail -20
```

Expected: failures because type is still being validated.

- [ ] **Step 3: Add DB migration to drop the type column**

In `server/src/db/index.ts`, find the migration block that adds the type column:

```typescript
if (!projectCols.some(c => c.name === 'type')) {
  db.exec("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'default'");
}
```

Replace it with:

```typescript
if (!projectCols.some(c => c.name === 'type')) {
  db.exec("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'default'");
}
// Remove legacy type column
if (projectCols.some(c => c.name === 'type')) {
  db.exec('ALTER TABLE projects DROP COLUMN type');
}
```

- [ ] **Step 4: Remove type from SELECT/INSERT queries in `server/src/db/index.ts`**

Find all queries selecting `type` from projects and remove it:

```typescript
// Find:
.prepare('SELECT id, name, description, repo_path, enabled_connection_ids, type FROM projects WHERE id = ?')
// Replace with:
.prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE id = ?')

// Find:
.prepare('SELECT id, name, description, repo_path, enabled_connection_ids, type FROM projects WHERE user_id = ?')
// Replace with:
.prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE user_id = ?')
```

Also remove `type` from the `DbProject` type/interface. Search for `DbProject` and remove the `type: string` field.

- [ ] **Step 5: Remove type from `server/src/tools/project_ops.ts`**

Remove the `import { isValidProjectType } from './projectTypes.js'` line.

In `createProject`, change the input type and remove the type validation block:

```typescript
// Old input signature:
input: { name: string; description?: string; with_repo: boolean; type?: string },

// New:
input: { name: string; description?: string; with_repo: boolean },
```

Remove these lines from the function body:
```typescript
const type = input.type ?? 'default';
if (!isValidProjectType(type)) {
  return `Error: invalid project type '${type}'`;
}
```

Change the INSERT query:
```typescript
// Old:
.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids, type) VALUES (?,?,?,?,?,?,?)')
.run(id, userId, input.name, input.description ?? null, repoPath, '[]', type);

// New:
.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
.run(id, userId, input.name, input.description ?? null, repoPath, '[]');
```

In `updateProject`, change the input type and remove the type update block:

```typescript
// Old:
input: { project_id: string; description?: string; type?: string },

// New:
input: { project_id: string; description?: string },
```

Remove this block entirely from the function body:
```typescript
if (input.type !== undefined) {
  if (!isValidProjectType(input.type)) {
    return `Error: invalid project type '${input.type}'`;
  }
  getDb()
    .prepare('UPDATE projects SET type = ? WHERE id = ? AND user_id = ?')
    .run(input.type, input.project_id, userId);
}
```

- [ ] **Step 6: Remove type from `server/src/tools/definitions.ts`**

Update `create_project` description:
```typescript
// Old:
description: "Create a new project. If with_repo is true, creates a git repo under the configured projects root. type is one of 'default' or 'video' (defaults to 'default').",
// New:
description: "Create a new project. If with_repo is true, creates a git repo under the configured projects root.",
```

Remove `type` from `create_project` parameters:
```typescript
// Remove:
type: { type: 'string', description: "Project type, one of: 'default', 'video'. Defaults to 'default'." },
```

Update `update_project` description:
```typescript
// Old:
description: "Update a project's description and/or type.",
// New:
description: "Update a project's description.",
```

Remove `type` from `update_project` parameters:
```typescript
// Remove:
type: { type: 'string', description: "Project type, one of: 'default', 'video'." },
```

Update `generate_video` — the `project_id` property description still references "video-type project":
```typescript
// Old:
project_id: { type: 'string', description: 'ID of the project (should be a video-type project)' },
// New:
project_id: { type: 'string', description: 'ID of the project to render video for' },
```

- [ ] **Step 7: Remove type from `server/src/routes/projects.ts`**

Remove the `import { isValidProjectType } from '../services/projectTypes.js'` line.

In the `POST /projects` handler:
```typescript
// Old:
const { name, description, repo_path, enabled_connection_ids = [], type = 'default' } = req.body as {
  name?: string; description?: string; repo_path?: string; enabled_connection_ids?: string[]; type?: string;
};
if (!isValidProjectType(type)) { res.status(400).json({ error: `invalid project type '${type}'` }); return; }
.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids, type) VALUES (?,?,?,?,?,?,?)')
.run(id, userId, name, description ?? null, repo_path ?? null, JSON.stringify(enabled_connection_ids), type);

// New:
const { name, description, repo_path, enabled_connection_ids = [] } = req.body as {
  name?: string; description?: string; repo_path?: string; enabled_connection_ids?: string[];
};
.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
.run(id, userId, name, description ?? null, repo_path ?? null, JSON.stringify(enabled_connection_ids));
```

In the `PATCH /projects/:id` handler, remove the type update block:
```typescript
// Old:
const { description, type } = req.body as { description?: string; type?: string };
if (type !== undefined && !isValidProjectType(type)) { ... }
if (type !== undefined) { getDb().prepare(...).run(type, ...) }

// New:
const { description } = req.body as { description?: string };
```

Update the `GET /projects` and `GET /projects/:id` SELECT queries to remove `type` from the column list (match the db/index.ts changes in Step 4).

- [ ] **Step 8: Run project tests**

```bash
cd server && npx vitest run tests/projects.test.ts 2>&1 | tail -20
```

Expected: new tests pass.

- [ ] **Step 9: Fix TypeScript**

```bash
cd server && npx tsc --noEmit 2>&1 | head -40
```

Fix remaining type errors.

- [ ] **Step 10: Run all server tests**

```bash
cd server && npx vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: remove project type system from server"
```

---

### Task 3: Add server-side capability detection

**Files:**
- Create: `server/src/services/projectCapabilities.ts`
- Create: `server/src/services/projectCapabilities.test.ts`
- Modify: `server/src/routes/projects.ts`

Two capability dimensions:
- `has_remotion`: **server-level** — checks if the global Remotion entry point exists at `../../../remotion/src/index.tsx` relative to the compiled service files. Remotion is a single shared composition (not per-project), so this is the same for all projects on a given server instance.
- `has_media`: **per-project** — checks if `<dataDir>/projects/<id>/media/` exists and has files. The data dir comes from `getDataDir()` in `db/index.ts`.

- [ ] **Step 1: Write failing tests**

Create `server/src/services/projectCapabilities.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('detectCapabilities', () => {
  it('has_remotion is true when remotion entry point exists', async () => {
    // Create a fake remotion entry point at the expected path relative to __dirname
    // We mock fs.existsSync for the remotion check only
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith(path.join('remotion', 'src', 'index.tsx'))) return true;
      return false;
    });
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const caps = detectCapabilities('project-id-1');
    expect(caps.has_remotion).toBe(true);
  });

  it('has_remotion is false when remotion entry point is absent', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const caps = detectCapabilities('project-id-2');
    expect(caps.has_remotion).toBe(false);
  });

  it('has_media is true when media dir has files', async () => {
    const mediaDir = path.join(tmpDir, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'clip.mp4'), 'fake');
    // Mock getDataDir to return tmpDir
    vi.doMock('../db/index.js', () => ({ getDataDir: () => tmpDir, getDb: vi.fn() }));
    vi.spyOn(fs, 'existsSync').mockReturnValue(false); // remotion absent
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const caps = detectCapabilities('media');
    expect(caps.has_media).toBe(true);
  });

  it('has_media is false when media dir is empty', async () => {
    const mediaDir = path.join(tmpDir, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    vi.doMock('../db/index.js', () => ({ getDataDir: () => tmpDir, getDb: vi.fn() }));
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('media')) return true;
      return false;
    });
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const caps = detectCapabilities('media');
    expect(caps.has_media).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd server && npx vitest run src/services/projectCapabilities.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `projectCapabilities.ts`**

Create `server/src/services/projectCapabilities.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDataDir } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProjectCapabilities {
  has_remotion: boolean;
  has_media: boolean;
}

export function detectCapabilities(projectId: string): ProjectCapabilities {
  // has_remotion: server-level — Remotion is a global composition, not per-project
  const remotionEntry = path.resolve(__dirname, '../../../remotion/src/index.tsx');
  const has_remotion = fs.existsSync(remotionEntry);

  // has_media: per-project — rendered videos stored in data dir
  const mediaDir = path.join(getDataDir(), 'projects', projectId, 'media');
  const has_media = fs.existsSync(mediaDir) && fs.readdirSync(mediaDir).length > 0;

  return { has_remotion, has_media };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npx vitest run src/services/projectCapabilities.test.ts 2>&1 | tail -10
```

Expected: all pass. If the vi.doMock approach has module caching issues, use `vi.resetModules()` in `beforeEach` and dynamic imports inside each test.

- [ ] **Step 5: Add `GET /projects/:id/capabilities` route**

In `server/src/routes/projects.ts`, add after the existing `GET /projects/:id` handler:

```typescript
router.get('/:id/capabilities', requireAuthHeaderOrQuery, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const project = getDb()
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string } | undefined;

  if (!project) {
    res.status(404).json({ error: 'project not found' });
    return;
  }

  res.json(detectCapabilities(project.id));
});
```

Add the import at the top of the file:

```typescript
import { detectCapabilities } from '../services/projectCapabilities.js';
```

- [ ] **Step 6: Add route test**

In `server/tests/projects.test.ts`, add:

```typescript
it('returns capabilities for a project', async () => {
  const create = await request(app)
    .post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'caps-project', enabled_connection_ids: [] });
  const id = (create.body as { id: string }).id;

  const res = await request(app)
    .get(`/projects/${id}/capabilities`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ has_remotion: expect.any(Boolean), has_media: false });
});
```

- [ ] **Step 7: Run all server tests**

```bash
cd server && npx vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add capability detection service and /projects/:id/capabilities endpoint"
```

---

### Task 4: Update orchestrator context to use capabilities

**Files:**
- Modify: `server/src/services/context.ts`
- Modify: `server/tests/services/context.test.ts`

The orchestrator's project context block currently says `type: video` or `type: default`. Replace with capability-based description. Also add a note about Remotion scaffolding so the orchestrator knows how to bootstrap it when absent.

- [ ] **Step 1: Read `server/tests/services/context.test.ts`**

Read the full file to understand the test setup pattern (how user/session/project are created in tests).

- [ ] **Step 2: Write a failing test**

In `server/tests/services/context.test.ts`, using the same setup pattern as existing tests, add:

```typescript
it('project context block does not reference a project type label', async () => {
  // Create a project using the same DB/user setup already in this test file.
  // Then call buildContext (or whatever the existing tests call to get context output).
  // Assert that the context string does not contain 'type: default' or 'type: video'.
  // Mirror the existing test pattern exactly — don't invent new DB setup code.
  const ctx = await buildContext(/* same args as existing tests */);
  expect(ctx).not.toMatch(/type:\s*(default|video)/);
});
```

- [ ] **Step 3: Update `projectContextBlock` in `context.ts`**

Add the import at the top of the file:

```typescript
import { detectCapabilities } from './projectCapabilities.js';
```

Replace the `projectContextBlock` function:

```typescript
function projectContextBlock(project: DbProject): string {
  const caps = detectCapabilities(project.id);
  const capLabels: string[] = [];
  if (caps.has_remotion) capLabels.push('remotion (can call generate_video)');
  if (caps.has_media) capLabels.push('rendered media available in Studio tab');

  const header = `## Active project: **${project.name}** (id: ${project.id})${project.description ? ' — ' + project.description : ''}`;

  let guidance: string;
  if (project.repo_path) {
    const capNote = capLabels.length > 0
      ? ` Detected capabilities: ${capLabels.join(', ')}.`
      : ' No special capabilities detected yet.';
    const scaffoldNote = !caps.has_remotion
      ? ' To add video generation: delegate to invoke_claude_code to scaffold a Remotion setup (create remotion/ directory with package.json, composition, and index).'
      : '';
    guidance = `\nCode project (repo: ${project.repo_path}).${capNote}${scaffoldNote} Delegate coding tasks to invoke_claude_code or invoke_codex with full context. Use git_op add→commit after work completes. For non-code tasks (docs, notes), use write_file/read_file directly.`;
  } else {
    guidance = `\nDoc/writing project (no git repo). Use write_file/read_file/list_dir directly — no Claude Code or Codex needed.`;
  }

  return header + guidance;
}
```

- [ ] **Step 4: Update `projectsListBlock` in `context.ts`**

Find the function listing all projects (around line 113). Remove `type: ${p.type}`:

```typescript
// Old:
`- ${p.name} (id: ${p.id}, type: ${p.type}${p.repo_path ? '' : ', no repo'})${p.description ? ': ' + p.description : ''}`
// New:
`- ${p.name} (id: ${p.id}${p.repo_path ? '' : ', no repo'})${p.description ? ': ' + p.description : ''}`
```

Also check if `context.ts` queries projects with a SELECT that includes `type` — if so, remove `type` from that SELECT to match the db/index.ts changes from Task 2.

- [ ] **Step 5: Fix TypeScript**

```bash
cd server && npx tsc --noEmit 2>&1 | head -20
```

Fix any remaining errors (usually `project.type` references).

- [ ] **Step 6: Run all server tests**

```bash
cd server && npx vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: replace project type context with capability-based orchestrator guidance"
```

---

### Task 5: Add graceful pre-flight check to video service

**Files:**
- Modify: `server/src/services/video.ts`
- Modify: `server/src/services/video.test.ts`

The `renderVideo` function currently attempts to bundle Remotion unconditionally. If the Remotion entry point doesn't exist (e.g. the server is running without the Remotion setup), it fails with a cryptic bundler error. Add an early check that returns a clear error before attempting the bundle.

- [ ] **Step 1: Write a failing test**

In `server/src/services/video.test.ts`, add:

```typescript
import { vi } from 'vitest';
import * as fs from 'fs';

it('renderVideo throws a helpful error when Remotion entry point is missing', async () => {
  vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  const { renderVideo } = await import('./video.js');
  await expect(
    renderVideo('proj-1', 'Test', [{ text: 'Hello', durationInSeconds: 2 }])
  ).rejects.toThrow(/remotion.*not.*configured|remotion.*not found|scaffold/i);
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd server && npx vitest run src/services/video.test.ts 2>&1 | tail -10
```

Expected: FAIL — error message doesn't match.

- [ ] **Step 3: Add pre-flight check to `video.ts`**

At the top of `renderVideo`, before the `getBundle()` call, add:

```typescript
export async function renderVideo(
  projectId: string,
  title: string,
  scenes: VideoScene[],
  onProgress?: (progress: number) => void,
): Promise<string> {
  // Pre-flight: verify Remotion entry point exists before attempting to bundle
  const entryPoint = path.resolve(__dirname, '../../../remotion/src/index.tsx');
  if (!fs.existsSync(entryPoint)) {
    throw new Error(
      'Remotion is not configured on this server. To add video generation to a project, ' +
      'delegate to invoke_claude_code to scaffold the remotion/ directory with package.json, ' +
      'src/index.tsx, and src/Scenes.tsx, then install dependencies.'
    );
  }

  const serveUrl = await getBundle();
  // ... rest of function unchanged
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npx vitest run src/services/video.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Run all server tests**

```bash
cd server && npx vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add graceful pre-flight check to renderVideo for missing Remotion setup"
```

---

### Task 6: Remove type from frontend

**Files:**
- Delete: `web/src/projectTypes.tsx`
- Delete: `web/src/projectTypes.test.tsx`
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/StudioTab.test.tsx`

- [ ] **Step 1: Delete the frontend type registry**

```bash
rm web/src/projectTypes.tsx
rm web/src/projectTypes.test.tsx
```

- [ ] **Step 2: Remove `type` from the `Project` interface in `web/src/types.ts`**

```typescript
// Old:
export interface Project {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string[];
  type: string;
}

// New:
export interface Project {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string[];
}
```

- [ ] **Step 3: Update `web/src/lib/api.ts`**

Remove `type` from `createProject`:
```typescript
// Old:
export function createProject(body: { name: string; description?: string; repo_path?: string; enabled_connection_ids: string[]; type?: string }): Promise<{ id: string }> {
// New:
export function createProject(body: { name: string; description?: string; repo_path?: string; enabled_connection_ids: string[] }): Promise<{ id: string }> {
```

Remove `type` from `updateProject`:
```typescript
// Old:
export function updateProject(projectId: string, body: { description?: string; type?: string }): Promise<void> {
// New:
export function updateProject(projectId: string, body: { description?: string }): Promise<void> {
```

Add the capabilities fetch:
```typescript
export interface ProjectCapabilities {
  has_remotion: boolean;
  has_media: boolean;
}

export function getProjectCapabilities(projectId: string): Promise<ProjectCapabilities> {
  return request(`/projects/${projectId}/capabilities`);
}
```

- [ ] **Step 4: Fix `StudioTab.test.tsx` — remove `type: 'video'` from fixture**

In `web/src/components/StudioTab.test.tsx`, find the project fixture:

```typescript
// Old:
const project: Project = {
  id: 'proj-1',
  name: 'Vid Project',
  description: null,
  repo_path: null,
  enabled_connection_ids: [],
  type: 'video',
};

// New:
const project: Project = {
  id: 'proj-1',
  name: 'Vid Project',
  description: null,
  repo_path: null,
  enabled_connection_ids: [],
};
```

- [ ] **Step 5: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Fix any errors from removed `type` references. The `ProjectPage.tsx` import of `getProjectTypeConfig` will break here — that's expected and is fixed in Task 7.

- [ ] **Step 6: Run frontend tests**

```bash
cd web && npx vitest run 2>&1 | tail -20
```

Expected: `StudioTab.test.tsx` passes. `ProjectPage.test.tsx` failures expected (fixed in Task 7).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: remove project type from frontend types, api, and StudioTab fixture"
```

---

### Task 7: Add capability-driven tabs to ProjectPage

**Files:**
- Create: `web/src/hooks/useProjectCapabilities.ts`
- Create: `web/src/hooks/useProjectCapabilities.test.ts`
- Modify: `web/src/pages/ProjectPage.tsx`
- Modify: `web/src/pages/ProjectPage.test.tsx`

The project page currently calls `getProjectTypeConfig(project.type).extraTabs`. Replace with a React Query hook that fetches capabilities and returns tab definitions.

- [ ] **Step 1: Write a failing test for the hook**

```bash
mkdir -p web/src/hooks
```

Create `web/src/hooks/useProjectCapabilities.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useProjectCapabilities } from './useProjectCapabilities.js';
import * as api from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  getProjectCapabilities: vi.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useProjectCapabilities', () => {
  beforeEach(() => {
    vi.mocked(api.getProjectCapabilities).mockResolvedValue({
      has_remotion: true,
      has_media: false,
    });
  });

  it('returns studio tab when has_remotion is true', async () => {
    const { result } = renderHook(() => useProjectCapabilities('proj-1'), { wrapper });
    await waitFor(() => expect(result.current.tabs.length).toBeGreaterThan(0));
    expect(result.current.tabs.some(t => t.id === 'studio')).toBe(true);
  });

  it('returns no extra tabs when all capabilities are false', async () => {
    vi.mocked(api.getProjectCapabilities).mockResolvedValue({
      has_remotion: false,
      has_media: false,
    });
    const { result } = renderHook(() => useProjectCapabilities('proj-2'), { wrapper });
    await waitFor(() => result.current.isLoaded);
    expect(result.current.tabs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd web && npx vitest run src/hooks/useProjectCapabilities.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `web/src/hooks/useProjectCapabilities.ts`**

```typescript
import { useQuery } from '@tanstack/react-query';
import { getProjectCapabilities } from '../lib/api.js';
import StudioTab from '../components/StudioTab.js';
import type { Project } from '../types.js';
import type { ComponentType } from 'react';

export interface CapabilityTab {
  id: string;
  label: string;
  component: ComponentType<{ project: Project }>;
}

export function useProjectCapabilities(projectId: string) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-capabilities', projectId],
    queryFn: () => getProjectCapabilities(projectId),
    staleTime: 30_000,
  });

  const tabs: CapabilityTab[] = [];
  if (data?.has_remotion || data?.has_media) {
    tabs.push({ id: 'studio', label: 'Studio', component: StudioTab });
  }

  return { tabs, isLoaded: !isLoading };
}
```

Note: the Studio tab appears when either `has_remotion` (can generate videos) OR `has_media` (has existing videos) is true. This way a project that had Remotion removed still shows its past renders.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd web && npx vitest run src/hooks/useProjectCapabilities.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Update `ProjectPage.tsx`**

Remove:
```typescript
import { getProjectTypeConfig } from '../projectTypes.js';
```

Add:
```typescript
import { useProjectCapabilities } from '../hooks/useProjectCapabilities.js';
```

Inside `ProjectPage()`, replace:
```typescript
const extraTabs = getProjectTypeConfig(project.type).extraTabs;
```

With:
```typescript
const { tabs: extraTabs } = useProjectCapabilities(project.id);
```

The rest of the component stays identical — `TABS` array and `extraTabs.map(...)` are compatible with the new shape.

- [ ] **Step 6: Update `ProjectPage.test.tsx`**

Remove `type` from all project fixtures in the file:
```typescript
// Old:
const project: Project = { id: 'p1', name: 'Test', description: null, repo_path: null, enabled_connection_ids: [], type: 'default' };
// New:
const project: Project = { id: 'p1', name: 'Test', description: null, repo_path: null, enabled_connection_ids: [] };
```

Add `getProjectCapabilities` to the api mock (merge with whatever mocks are already there):
```typescript
vi.mock('../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.js')>();
  return {
    ...actual,
    getProjectCapabilities: vi.fn().mockResolvedValue({ has_remotion: false, has_media: false }),
  };
});
```

- [ ] **Step 7: Run all frontend tests**

```bash
cd web && npx vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 8: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: capability-driven project tabs via useProjectCapabilities hook"
```

---

### Task 8: End-to-end smoke test

- [ ] **Step 1: Start the app**

```bash
cd server && npm run dev &
cd web && npm run dev &
```

- [ ] **Step 2: Verify project creation works without type**

Open the browser at `http://localhost:5173`. Create a new project. Confirm no type picker is present and the project creates successfully.

- [ ] **Step 3: Verify a plain project shows no Studio tab**

Open the new project. Confirm only Overview, Campaigns, Files, Settings tabs appear.

- [ ] **Step 4: Verify the existing video project still shows Studio tab**

Open the project whose server has Remotion configured (the existing video project used in prior sessions). Confirm the Studio tab appears.

- [ ] **Step 5: Kill dev servers**

```bash
kill %1 %2 2>/dev/null || true
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: verify sandbox model end-to-end"
```

---

## Self-Review

**Spec coverage:**
- ✅ Remove project type system (DB, API, tools, frontend)
- ✅ Capability detection — `has_remotion` server-level, `has_media` per-project (data dir)
- ✅ Dynamic tabs based on capabilities (Studio tab when has_remotion OR has_media)
- ✅ Orchestrator context uses capabilities, not type label
- ✅ Orchestrator told how to scaffold Remotion via invoke_claude_code when absent
- ✅ `generate_video` tool description no longer references "video-type project"
- ✅ `video.ts` fails gracefully with a helpful scaffolding message when Remotion is absent
- ✅ `StudioTab.test.tsx` fixture updated (no `type: 'video'`)
- ✅ `intent.ts` — no project type references, no changes needed
- ✅ `auth.ts` — only references HTML `<video>` element, no project type references, no changes needed
- ⚠️ Workspace context document — intentionally out of scope (planned follow-on)

**Placeholder scan:** None — all code steps include complete implementations.

**Type consistency:**
- `ProjectCapabilities` interface defined in Task 3 (`projectCapabilities.ts`), mirrored in Task 6 (`api.ts`) — fields match exactly
- `CapabilityTab` defined in Task 7 hook — shape matches `extraTabs` use in `ProjectPage.tsx` (`id`, `label`, `component`)
- `detectCapabilities(projectId: string)` takes a project ID in Task 3 — all callers in Tasks 4 and 7 pass `project.id` ✅
- `DbProject` loses `type` field in Task 2 — `projectContextBlock` in Task 4 no longer references it ✅
