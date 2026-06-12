# Project-Type Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give projects a `type` field and let the frontend register additional tabs per project type, so non-code project types (starting with video) can have their own UI without forking `ProjectPage`.

**Architecture:** Add a `type` column to `projects` (default `'default'`), a shared `PROJECT_TYPES` list on the backend for validation, and a `PROJECT_TYPE_REGISTRY` on the frontend mapping type → extra tabs. `ProjectPage` becomes type-aware by splicing `extraTabs` into its tab list and content.

**Tech Stack:** better-sqlite3, Express, React 19, Vitest + Testing Library

---

### Task 1: Add `type` column to `projects` table

**Files:**
- Modify: `server/src/db/index.ts`

- [ ] **Step 1: Add migration block**

In `server/src/db/index.ts`, immediately after the `sessionCols` migration block (after line 226, the `summary` column check), add:

```ts
const projectCols = db.prepare("SELECT name FROM pragma_table_info('projects')").all() as { name: string }[];
if (!projectCols.some(c => c.name === 'type')) {
  db.exec("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'default'");
}
```

- [ ] **Step 2: Update `DbProject` interface**

Find the `DbProject` interface (around line 339-345) and add `type: string;`:

```ts
export interface DbProject {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string;
  type: string;
}
```

- [ ] **Step 3: Update SELECT queries to include `type`**

Update `getProjectForUser` and `getProjectsForUser` (around lines 347-351 and 386-390) to select `type`:

```ts
export function getProjectForUser(projectId: string, userId: string): DbProject | undefined {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids, type FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId) as DbProject | undefined;
}
```

```ts
export function getProjectsForUser(userId: string): DbProject[] {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids, type FROM projects WHERE user_id = ?')
    .all(userId) as DbProject[];
}
```

Also search for any other `SELECT ... FROM projects` in `server/src/` (e.g. in `context.ts`'s `projectContextBlock`/`projectsListBlock` queries) and add `type` to those column lists too, since `DbProject` now requires it wherever it's the return type.

- [ ] **Step 4: Run server build to check for type errors**

Run: `npm run build --prefix server`
Expected: succeeds (TypeScript will flag any `DbProject`-typed query missing the new field if strict object shape checks apply — fix any reported call sites by adding `type` to their SELECT).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/index.ts
git commit -m "feat: add type column to projects table"
```

---

### Task 2: Add shared `PROJECT_TYPES` constant and validation

**Files:**
- Create: `server/src/services/projectTypes.ts`
- Test: `server/src/services/projectTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { PROJECT_TYPES, isValidProjectType } from './projectTypes.js';

describe('projectTypes', () => {
  it('includes default and video', () => {
    expect(PROJECT_TYPES).toContain('default');
    expect(PROJECT_TYPES).toContain('video');
  });

  it('validates known types', () => {
    expect(isValidProjectType('default')).toBe(true);
    expect(isValidProjectType('video')).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isValidProjectType('not-a-type')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix server -- projectTypes`
Expected: FAIL with "Cannot find module './projectTypes.js'"

- [ ] **Step 3: Write implementation**

```ts
export const PROJECT_TYPES = ['default', 'video'] as const;

export type ProjectType = typeof PROJECT_TYPES[number];

export function isValidProjectType(type: string): type is ProjectType {
  return (PROJECT_TYPES as readonly string[]).includes(type);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix server -- projectTypes`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/projectTypes.ts server/src/services/projectTypes.test.ts
git commit -m "feat: add PROJECT_TYPES constant and validation"
```

---

### Task 3: Accept `type` in `create_project` / `update_project`

**Files:**
- Modify: `server/src/tools/project_ops.ts`
- Modify: `server/src/tools/definitions.ts`
- Modify: `server/src/services/agent.ts`
- Test: `server/src/tools/project_ops.test.ts`

- [ ] **Step 1: Write failing tests**

Check if `server/src/tools/project_ops.test.ts` already exists (`ls server/src/tools/*.test.ts`). If not, create it. Add tests for the new behavior (adapt the DB setup to match whatever pattern existing service tests use — check `server/src/services/*.test.ts` for the in-memory DB setup helper, e.g. `getDb()`/`initDb()` pattern, and mirror it here):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createProject, updateProject } from './project_ops.js';
import { getDb, getProjectForUser } from '../db/index.js';

// NOTE: adapt this setup to match the existing test DB initialization pattern
// used by other server/src/services/*.test.ts files (in-memory sqlite + initDb()).

describe('createProject with type', () => {
  it('defaults to type "default" when not specified', async () => {
    const result = await createProject({ name: 'proj-a', with_repo: false }, 'user-1', 'exec-1');
    const id = result.match(/id: (\S+)\)/)?.[1]!;
    const project = getProjectForUser(id, 'user-1');
    expect(project?.type).toBe('default');
  });

  it('persists a valid type', async () => {
    const result = await createProject({ name: 'proj-b', with_repo: false, type: 'video' }, 'user-1', 'exec-1');
    const id = result.match(/id: (\S+)\)/)?.[1]!;
    const project = getProjectForUser(id, 'user-1');
    expect(project?.type).toBe('video');
  });

  it('rejects an invalid type', async () => {
    const result = await createProject({ name: 'proj-c', with_repo: false, type: 'bogus' }, 'user-1', 'exec-1');
    expect(result).toMatch(/Error/);
  });
});

describe('updateProject with type', () => {
  it('updates the type when valid', async () => {
    const created = await createProject({ name: 'proj-d', with_repo: false }, 'user-1', 'exec-1');
    const id = created.match(/id: (\S+)\)/)?.[1]!;
    await updateProject({ project_id: id, type: 'video' }, 'user-1');
    const project = getProjectForUser(id, 'user-1');
    expect(project?.type).toBe('video');
  });

  it('rejects an invalid type', async () => {
    const created = await createProject({ name: 'proj-e', with_repo: false }, 'user-1', 'exec-1');
    const id = created.match(/id: (\S+)\)/)?.[1]!;
    const result = await updateProject({ project_id: id, type: 'bogus' }, 'user-1');
    expect(result).toMatch(/Error/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix server -- project_ops`
Expected: FAIL (createProject/updateProject don't accept `type` yet, and `proj-b`'s `type` won't be `'video'`)

- [ ] **Step 3: Update `createProject`**

In `server/src/tools/project_ops.ts`, update the signature and INSERT (around lines 15-41):

```ts
import { isValidProjectType } from '../services/projectTypes.js';

export async function createProject(
  input: { name: string; description?: string; with_repo: boolean; type?: string },
  userId: string,
  _executionId: string
): Promise<string> {
  const type = input.type ?? 'default';
  if (!isValidProjectType(type)) {
    return `Error: invalid project type '${type}'`;
  }

  let repoPath: string | null = null;

  if (input.with_repo) {
    const root = getProjectsRoot(userId);
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
    .prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids, type) VALUES (?,?,?,?,?,?,?)')
    .run(id, userId, input.name, input.description ?? null, repoPath, '[]', type);

  return `Created project '${input.name}' (id: ${id})${repoPath ? ` with repo at ${repoPath}` : ' with no repo'}`;
}
```

- [ ] **Step 4: Update `updateProject`**

```ts
export async function updateProject(
  input: { project_id: string; description?: string; type?: string },
  userId: string
): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);
  if (!project) return `Error: project ${input.project_id} not found`;

  if (input.type !== undefined) {
    if (!isValidProjectType(input.type)) {
      return `Error: invalid project type '${input.type}'`;
    }
    getDb()
      .prepare('UPDATE projects SET type = ? WHERE id = ? AND user_id = ?')
      .run(input.type, input.project_id, userId);
  }

  if (input.description !== undefined) {
    getDb()
      .prepare('UPDATE projects SET description = ? WHERE id = ? AND user_id = ?')
      .run(input.description, input.project_id, userId);
  }

  return `Project '${project.name}' updated`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix server -- project_ops`
Expected: PASS

- [ ] **Step 6: Update tool definitions**

In `server/src/tools/definitions.ts`, add `type` to `create_project`'s `input_schema.properties` (around line 144-155):

```ts
{
  name: 'create_project',
  description: "Create a new project. If with_repo is true, creates a git repo under the configured projects root. type is one of 'default' or 'video' (defaults to 'default').",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Project name' },
      description: { type: 'string', description: 'Optional description' },
      with_repo: { type: 'boolean', description: 'Whether to create a backing git repo for this project' },
      type: { type: 'string', description: "Project type, one of: 'default', 'video'. Defaults to 'default'." },
    },
    required: ['name', 'with_repo'],
  },
},
```

And to `update_project` (around line 157-167):

```ts
{
  name: 'update_project',
  description: "Update a project's description and/or type.",
  input_schema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' },
      description: { type: 'string' },
      type: { type: 'string', description: "Project type, one of: 'default', 'video'." },
    },
    required: ['project_id'],
  },
},
```

(Note: `description` is no longer `required` for `update_project` since a type-only update is now valid.)

- [ ] **Step 7: Update dispatch in `agent.ts`**

In `server/src/services/agent.ts`, update the `create_project` and `update_project` cases (around lines 300-309):

```ts
case 'create_project':
  result = await createProject(
    {
      name: toolInput.name as string,
      description: toolInput.description as string | undefined,
      with_repo: toolInput.with_repo as boolean,
      type: toolInput.type as string | undefined,
    },
    userId,
    executionId
  );
  break;
case 'update_project':
  result = await updateProject(
    {
      project_id: toolInput.project_id as string,
      description: toolInput.description as string | undefined,
      type: toolInput.type as string | undefined,
    },
    userId
  );
  break;
```

- [ ] **Step 8: Run full server test suite**

Run: `npm test --prefix server`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/src/tools/project_ops.ts server/src/tools/project_ops.test.ts server/src/tools/definitions.ts server/src/services/agent.ts
git commit -m "feat: support project type in create_project/update_project"
```

---

### Task 4: Add `type` to frontend `Project` type and create the tab registry

**Files:**
- Modify: `web/src/types.ts`
- Create: `web/src/projectTypes.tsx`
- Test: `web/src/projectTypes.test.tsx`

- [ ] **Step 1: Update `Project` type**

In `web/src/types.ts`, update the `Project` interface (around lines 52-58):

```ts
export interface Project {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string[];
  type: string;
}
```

- [ ] **Step 2: Write failing test for the registry**

```tsx
import { describe, it, expect } from 'vitest';
import { PROJECT_TYPE_REGISTRY } from './projectTypes.js';

describe('PROJECT_TYPE_REGISTRY', () => {
  it('has a default entry with no extra tabs', () => {
    expect(PROJECT_TYPE_REGISTRY.default.extraTabs).toEqual([]);
  });

  it('falls back to default for unknown types via getProjectTypeConfig', async () => {
    const { getProjectTypeConfig } = await import('./projectTypes.js');
    expect(getProjectTypeConfig('something-unknown')).toBe(PROJECT_TYPE_REGISTRY.default);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --prefix web -- projectTypes`
Expected: FAIL with "Cannot find module './projectTypes.js'"

- [ ] **Step 4: Create the registry**

```tsx
import type { ComponentType } from 'react';
import type { Project } from './types.js';

export interface ProjectTabDef {
  id: string;
  label: string;
  component: ComponentType<{ project: Project }>;
}

export interface ProjectTypeConfig {
  /** Tabs appended after the base "files" tab, before "settings". */
  extraTabs: ProjectTabDef[];
}

export const PROJECT_TYPE_REGISTRY: Record<string, ProjectTypeConfig> = {
  default: {
    extraTabs: [],
  },
};

export function getProjectTypeConfig(type: string): ProjectTypeConfig {
  return PROJECT_TYPE_REGISTRY[type] ?? PROJECT_TYPE_REGISTRY.default;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix web -- projectTypes`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/projectTypes.tsx web/src/projectTypes.test.tsx
git commit -m "feat: add project type registry on frontend"
```

---

### Task 5: Make `ProjectPage` render registry-driven extra tabs

**Files:**
- Modify: `web/src/pages/ProjectPage.tsx`
- Test: `web/src/pages/ProjectPage.test.tsx`

- [ ] **Step 1: Write failing test**

Create `web/src/pages/ProjectPage.test.tsx`. Follow the mocking pattern from `web/src/components/ExecutionCard.test.tsx` (mock `../lib/api.js`) and use `MemoryRouter` since `ProjectPage` uses `react-router-dom` hooks:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectPage from './ProjectPage.js';
import { PROJECT_TYPE_REGISTRY } from '../projectTypes.js';
import type { Project } from '../types.js';

const fakeProject: Project = {
  id: 'proj-1',
  name: 'Test Project',
  description: null,
  repo_path: null,
  enabled_connection_ids: [],
  type: 'widget',
};

vi.mock('../lib/api.js', () => ({
  getProjects: vi.fn().mockResolvedValue([fakeProject]),
  getProjectCampaigns: vi.fn().mockResolvedValue([]),
  createChat: vi.fn(),
  updateChatConfig: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock('../components/FileBrowser.js', () => ({ default: () => <div>FileBrowser</div> }));

function WidgetTab({ project }: { project: Project }) {
  return <div>Widget tab for {project.name}</div>;
}

function renderPage(path: string) {
  const queryClient = new QueryClient();
  PROJECT_TYPE_REGISTRY.widget = { extraTabs: [{ id: 'widgets', label: 'Widgets', component: WidgetTab }] };
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ProjectPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectPage extra tabs', () => {
  it('shows the registry-provided extra tab', async () => {
    renderPage('/projects/proj-1');
    expect(await screen.findByRole('tab', { name: 'Widgets' })).toBeInTheDocument();
  });

  it('renders extra tab content when selected via URL', async () => {
    renderPage('/projects/proj-1/widgets');
    expect(await screen.findByText('Widget tab for Test Project')).toBeInTheDocument();
  });
});
```

Note: `ProjectPage` is normally reached via a route param (`useParams<{ projectId: string }>()`). With `MemoryRouter` and no `<Route>` defined, `useParams` returns `{}`. Wrap in a `<Routes><Route path="/projects/:projectId/*" element={<ProjectPage />} /></Routes>` so `projectId` resolves — adjust the test to import `Routes, Route` from `react-router-dom` and wrap accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix web -- ProjectPage`
Expected: FAIL — "Widgets" tab not found (registry not wired into `ProjectPage` yet)

- [ ] **Step 3: Update `ProjectPage.tsx`**

Change the `Tab` type and imports (line 25 and imports section):

```ts
type Tab = string;
```

Add import:

```ts
import { getProjectTypeConfig } from '../projectTypes.js';
```

Update `tabFromPath` / `tabHref` (lines 34-44) to accept arbitrary strings:

```ts
function tabFromPath(pathname: string): Tab {
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last === 'campaigns' || last === 'files' || last === 'settings') return last;
  // Any other trailing segment after the project id is treated as an extra tab id.
  if (segments.length >= 3 && segments[0] === 'projects') return last;
  return 'overview';
}

function tabHref(projectId: string, tab: Tab) {
  if (tab === 'overview') return `/projects/${projectId}`;
  return `/projects/${projectId}/${tab}`;
}
```

Inside the component, after `const TABS: { id: Tab; label: string }[] = [...]` (lines 95-100), splice in extra tabs from the registry:

```ts
const extraTabs = getProjectTypeConfig(project.type).extraTabs;

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: `Campaigns${campaigns.length > 0 ? ` (${campaigns.length})` : ''}` },
  { id: 'files', label: 'Files' },
  ...extraTabs.map(t => ({ id: t.id, label: t.label })),
  { id: 'settings', label: 'Settings' },
];
```

After the `{tab === 'files' && (...)}` block (line 233-237), add rendering for extra tabs:

```tsx
{extraTabs.map(t => (
  tab === t.id && (
    <div key={t.id} className="p-4 sm:p-6">
      <t.component project={project} />
    </div>
  )
))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix web -- ProjectPage`
Expected: PASS (2 tests)

- [ ] **Step 5: Run full web test suite to check for regressions**

Run: `npm test --prefix web`
Expected: PASS — existing `default`-type project pages (Overview/Campaigns/Files/Settings) render unchanged since `PROJECT_TYPE_REGISTRY.default.extraTabs` is `[]`.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ProjectPage.tsx web/src/pages/ProjectPage.test.tsx
git commit -m "feat: render registry-driven extra tabs in ProjectPage"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full build + test, both packages**

Run: `npm run build --prefix server && npm run build --prefix web && npm test --prefix server && npm test --prefix web`
Expected: all PASS

- [ ] **Step 2: Manual check**

Start the dev server (`npm run dev`), open an existing project — confirm Overview/Campaigns/Files/Settings tabs are unchanged (no "Widgets" tab, since that was only registered by the test).
