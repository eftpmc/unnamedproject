# Research Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the orchestrator writes `.md` files to `{dataDir}/projects/{projectId}/research/`, the app detects them (`has_research: true`), shows a "research saved" badge on the project overview, and adds a Research tab with a two-panel file browser.

**Architecture:** Follows the identical pattern as `has_media` / `has_graph`. Server-side: add `has_research` detection to `projectCapabilities.ts`, add two new endpoints to `projects.ts`. Client-side: add API functions, create `ResearchTab.tsx` component, add research tab to `useProjectCapabilities` hook. No database changes.

**Tech Stack:** Node.js/Express (server), React/TypeScript/TanStack Query (client), Vitest + supertest (server tests), Vitest + React Testing Library (client tests)

---

### Task 1: Add `has_research` detection to server and types

**Files:**
- Modify: `server/src/services/projectCapabilities.ts`
- Modify: `server/src/services/context.ts`
- Modify: `server/tests/projects.test.ts`
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Write a failing server test for `has_research` detection**

Open `server/tests/projects.test.ts`. Inside the existing `describe('projects', ...)` block, add a test after the existing capabilities test (after line 95):

```typescript
it('returns has_research true when research files exist', async () => {
  const create = await request(app)
    .post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'research-project', enabled_connection_ids: [] });
  const id = (create.body as { id: string }).id;

  // Create research directory with a markdown file
  const researchDir = path.join(process.env.DATA_DIR!, 'projects', id, 'research');
  fs.mkdirSync(researchDir, { recursive: true });
  fs.writeFileSync(path.join(researchDir, 'ai-landscape.md'), '# AI Landscape\nSome findings.');

  const res = await request(app)
    .get(`/projects/${id}/capabilities`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.has_research).toBe(true);
});

it('returns has_research false when no research files exist', async () => {
  const create = await request(app)
    .post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'no-research-project', enabled_connection_ids: [] });
  const id = (create.body as { id: string }).id;

  const res = await request(app)
    .get(`/projects/${id}/capabilities`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.has_research).toBe(false);
});
```

Note: `fs` and `path` are already imported in `projects.test.ts` (check top of file; if not, add `import fs from 'fs'; import path from 'path';`).

- [ ] **Step 2: Run to confirm the two new tests fail**

```bash
npm test --prefix server -- --run projects
```

Expected: the two new tests FAIL with `has_research` being `undefined`. Existing tests PASS.

- [ ] **Step 3: Add `has_research` to `ProjectCapabilities` and detection logic**

Open `server/src/services/projectCapabilities.ts`. Replace the entire file with:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDataDir } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProjectCapabilities {
  has_remotion: boolean;
  has_media: boolean;
  has_graph: boolean;
  has_research: boolean;
}

export function detectCapabilities(projectId: string, repoPath?: string | null): ProjectCapabilities {
  // has_remotion: server-level — Remotion is a global composition, not per-project
  const remotionEntry = path.resolve(__dirname, '../../../remotion/src/index.tsx');
  const has_remotion = fs.existsSync(remotionEntry);

  // has_media: per-project — check new data-dir path first, then repo out/ as fallback
  const mediaDir = path.join(getDataDir(), 'projects', projectId, 'media');
  let has_media = fs.existsSync(mediaDir) && fs.readdirSync(mediaDir).length > 0;

  if (!has_media && repoPath) {
    const outDir = path.join(repoPath, 'out');
    has_media = fs.existsSync(outDir) && fs.readdirSync(outDir).some(f => f.toLowerCase().endsWith('.mp4'));
  }

  // has_graph: per-project — graphify writes graph.json here when rebuild_graph is run
  const has_graph = repoPath
    ? fs.existsSync(path.join(repoPath, 'graphify-out', 'graph.json'))
    : false;

  // has_research: per-project — orchestrator writes .md files to {dataDir}/projects/{id}/research/
  const researchDir = path.join(getDataDir(), 'projects', projectId, 'research');
  const has_research = fs.existsSync(researchDir) &&
    fs.readdirSync(researchDir).some(f => f.endsWith('.md'));

  return { has_remotion, has_media, has_graph, has_research };
}
```

- [ ] **Step 4: Add research capability hint to orchestrator context**

Open `server/src/services/context.ts`. Find the block around line 102–104:

```typescript
  if (caps.has_remotion) capLabels.push('remotion (can call generate_video)');
  if (caps.has_media) capLabels.push('rendered media available in Studio tab');
  if (caps.has_graph) capLabels.push('code graph indexed — use project_query for broad codebase questions before reading individual files');
```

Add one line after:

```typescript
  if (caps.has_research) capLabels.push('research saved — write findings as .md files to {dataDir}/projects/{id}/research/');
```

- [ ] **Step 5: Add `has_research` to the client `ProjectCapabilities` type**

Open `web/src/lib/api.ts`. Find the `ProjectCapabilities` interface (around lines 185–192):

```typescript
interface ProjectCapabilities {
  has_remotion: boolean;
  has_media: boolean;
  has_graph: boolean;
}
```

Replace with:

```typescript
interface ProjectCapabilities {
  has_remotion: boolean;
  has_media: boolean;
  has_graph: boolean;
  has_research: boolean;
}
```

- [ ] **Step 6: Run server tests to confirm all pass**

```bash
npm test --prefix server -- --run projects
```

Expected: all tests in the projects suite PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/projectCapabilities.ts server/src/services/context.ts server/tests/projects.test.ts web/src/lib/api.ts
git commit -m "feat: add has_research capability detection"
```

---

### Task 2: Add research file endpoints to server

**Files:**
- Modify: `server/src/routes/projects.ts`
- Modify: `server/tests/projects.test.ts`

- [ ] **Step 1: Write failing tests for the two research endpoints**

Open `server/tests/projects.test.ts`. Add a new `describe` block after the existing `describe('project media', ...)` block:

```typescript
describe('project research', () => {
  let researchProjectId: string;
  let researchToken: string;

  beforeAll(async () => {
    const reg = await request(app)
      .post('/auth/register')
      .send({ email: `research-${Date.now()}@test.com`, password: 'pass' });
    researchToken = reg.body.token;

    const create = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${researchToken}`)
      .send({ name: 'research-test', enabled_connection_ids: [] });
    researchProjectId = (create.body as { id: string }).id;

    // Seed research files
    const researchDir = path.join(process.env.DATA_DIR!, 'projects', researchProjectId, 'research');
    fs.mkdirSync(researchDir, { recursive: true });
    fs.writeFileSync(path.join(researchDir, 'ai-landscape.md'), '# AI Landscape\nSome findings.');
    fs.writeFileSync(path.join(researchDir, 'market-analysis.md'), '# Market Analysis\nData here.');
  });

  it('lists research files for a project', async () => {
    const res = await request(app)
      .get(`/projects/${researchProjectId}/research`)
      .set('Authorization', `Bearer ${researchToken}`);
    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(2);
    const names = res.body.files.map((f: { name: string }) => f.name);
    expect(names).toContain('ai-landscape.md');
    expect(names).toContain('market-analysis.md');
    // Should have title and createdAt
    expect(res.body.files[0]).toHaveProperty('title');
    expect(res.body.files[0]).toHaveProperty('createdAt');
  });

  it('returns 200 with empty files array when no research dir exists', async () => {
    const create2 = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${researchToken}`)
      .send({ name: 'empty-research', enabled_connection_ids: [] });
    const emptyId = (create2.body as { id: string }).id;

    const res = await request(app)
      .get(`/projects/${emptyId}/research`)
      .set('Authorization', `Bearer ${researchToken}`);
    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(0);
  });

  it('returns markdown content of a research file', async () => {
    const res = await request(app)
      .get(`/projects/${researchProjectId}/research/ai-landscape.md`)
      .set('Authorization', `Bearer ${researchToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('AI Landscape');
  });

  it('returns 404 for a research file that does not exist', async () => {
    const res = await request(app)
      .get(`/projects/${researchProjectId}/research/nonexistent.md`)
      .set('Authorization', `Bearer ${researchToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects path traversal in research file request', async () => {
    const res = await request(app)
      .get(`/projects/${researchProjectId}/research/..%2F..%2Fetc%2Fpasswd`)
      .set('Authorization', `Bearer ${researchToken}`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
npm test --prefix server -- --run projects
```

Expected: the 6 new tests FAIL with 404 (routes don't exist yet). Existing tests PASS.

- [ ] **Step 3: Add a title helper and the two endpoints to `projects.ts`**

Open `server/src/routes/projects.ts`. After the last `router.get('/:id/media/...')` handler and before `export default router`, add:

```typescript
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
      return { name, title: researchFileTitle(name), createdAt: stat.birthtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  res.json({ files });
});

router.get('/:id/research/:filename', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getProjectForUser(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const researchDir = path.join(getDataDir(), 'projects', project.id, 'research');
  const filename = path.basename(req.params.filename);
  const filePath = path.join(researchDir, filename);

  // Path traversal guard
  if (!filePath.startsWith(researchDir + path.sep) && filePath !== researchDir) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  if (!fsSync.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const content = fsSync.readFileSync(filePath, 'utf-8');
  res.type('text/plain').send(content);
});
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
npm test --prefix server -- --run projects
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/projects.ts server/tests/projects.test.ts
git commit -m "feat: add research file list and content endpoints"
```

---

### Task 3: Add client API functions for research

**Files:**
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Add `ResearchFile` type and two API functions**

Open `web/src/lib/api.ts`. After the `ProjectCapabilities` interface, add the `ResearchFile` type:

```typescript
export interface ResearchFile {
  name: string;
  title: string;
  createdAt: number;
}
```

Then add these two functions after `getProjectCapabilities`:

```typescript
export function getResearchFiles(projectId: string): Promise<{ files: ResearchFile[] }> {
  return request(`/projects/${projectId}/research`);
}

export async function getResearchFile(projectId: string, filename: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`/projects/${projectId}/research/${encodeURIComponent(filename)}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
```

- [ ] **Step 2: Run existing web tests to confirm nothing broke**

```bash
npm test --prefix web -- --run
```

Expected: all existing tests PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat: add getResearchFiles and getResearchFile client API functions"
```

---

### Task 4: Create `ResearchTab` component (TDD)

**Files:**
- Create: `web/src/components/ResearchTab.tsx`
- Create: `web/src/components/ResearchTab.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `web/src/components/ResearchTab.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ResearchTab from './ResearchTab.js';

vi.mock('../lib/api.js', () => ({
  getResearchFiles: vi.fn().mockResolvedValue({
    files: [
      { name: 'ai-landscape.md', title: 'Ai Landscape', createdAt: Date.now() - 3600_000 },
      { name: 'market-analysis.md', title: 'Market Analysis', createdAt: Date.now() - 7200_000 },
    ],
  }),
  getResearchFile: vi.fn().mockResolvedValue('# AI Landscape\n\nSome research findings.'),
}));

const project = {
  id: 'proj-1',
  name: 'Test Project',
  description: null,
  repo_path: null,
  enabled_connection_ids: [],
};

function renderTab() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ResearchTab project={project} />
    </QueryClientProvider>
  );
}

describe('ResearchTab', () => {
  it('renders the list of research files', async () => {
    renderTab();
    expect(await screen.findByText('Ai Landscape')).toBeInTheDocument();
    expect(screen.getByText('Market Analysis')).toBeInTheDocument();
  });

  it('selects the first file by default and shows its content', async () => {
    renderTab();
    expect(await screen.findByText(/AI Landscape/)).toBeInTheDocument();
    expect(screen.getByText(/Some research findings/)).toBeInTheDocument();
  });

  it('switches content when a different file is clicked', async () => {
    const { getResearchFile } = await import('../lib/api.js');
    vi.mocked(getResearchFile).mockImplementation(async (_projectId, filename) =>
      filename === 'market-analysis.md'
        ? '# Market Analysis\n\nMarket data here.'
        : '# AI Landscape\n\nSome research findings.'
    );
    renderTab();
    await screen.findByText('Ai Landscape');
    await userEvent.click(screen.getByText('Market Analysis'));
    expect(await screen.findByText(/Market data here/)).toBeInTheDocument();
  });

  it('shows empty state when no files exist', async () => {
    const { getResearchFiles } = await import('../lib/api.js');
    (getResearchFiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] });
    renderTab();
    expect(await screen.findByText('No research files yet')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
npm test --prefix web -- --run ResearchTab
```

Expected: FAIL — `ResearchTab` module not found.

- [ ] **Step 3: Create the `ResearchTab` component**

Create `web/src/components/ResearchTab.tsx`:

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getResearchFiles, getResearchFile } from '../lib/api.js';
import { EmptyPanel, PageLoading } from '@/components/ui/app-layout';
import { timeAgo } from '../lib/utils.js';
import { cn } from '@/lib/utils';
import type { Project } from '../types.js';

export default function ResearchTab({ project }: { project: Project }) {
  const { data, isLoading: filesLoading } = useQuery({
    queryKey: ['research-files', project.id],
    queryFn: () => getResearchFiles(project.id),
    staleTime: 30_000,
  });

  const files = data?.files ?? [];
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const activeFile = selectedFile ?? files[0]?.name ?? null;

  const { data: content, isLoading: contentLoading } = useQuery({
    queryKey: ['research-file', project.id, activeFile],
    queryFn: () => getResearchFile(project.id, activeFile!),
    enabled: !!activeFile,
    staleTime: 60_000,
  });

  if (filesLoading) return <PageLoading rows={3} />;

  if (files.length === 0) {
    return (
      <EmptyPanel
        title="No research files yet"
        description="Ask the orchestrator to research a topic and findings will appear here."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* File list */}
      <div className="w-52 shrink-0 border-r border-border/40 overflow-y-auto">
        {files.map(file => (
          <button
            key={file.name}
            onClick={() => setSelectedFile(file.name)}
            className={cn(
              'flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors border-b border-border/30',
              activeFile === file.name
                ? 'bg-muted/50 text-foreground'
                : 'text-muted-foreground hover:bg-muted/20'
            )}
          >
            <span className="text-xs font-medium truncate">{file.title}</span>
            <span className="text-xs opacity-60">{timeAgo(file.createdAt)}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {contentLoading ? (
          <PageLoading rows={5} />
        ) : content ? (
          <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed">
            {content}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm all 4 pass**

```bash
npm test --prefix web -- --run ResearchTab
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ResearchTab.tsx web/src/components/ResearchTab.test.tsx
git commit -m "feat: add ResearchTab component with file list and content viewer"
```

---

### Task 5: Wire up the Research tab + overview badge

**Files:**
- Modify: `web/src/hooks/useProjectCapabilities.ts`
- Modify: `web/src/pages/ProjectPage.tsx`

- [ ] **Step 1: Add research tab to `useProjectCapabilities`**

Open `web/src/hooks/useProjectCapabilities.ts`. Add the ResearchTab import:

```typescript
import ResearchTab from '../components/ResearchTab.js';
```

Then, after the existing `if (data?.has_remotion || data?.has_media)` block, add:

```typescript
  if (data?.has_research) {
    tabs.push({ id: 'research', label: 'Research', component: ResearchTab });
  }
```

The full hook after changes:

```typescript
import { useQuery } from '@tanstack/react-query';
import { getProjectCapabilities } from '../lib/api.js';
import StudioTab from '../components/StudioTab.js';
import ResearchTab from '../components/ResearchTab.js';
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
  if (data?.has_research) {
    tabs.push({ id: 'research', label: 'Research', component: ResearchTab });
  }

  return { tabs, isLoaded: !isLoading };
}
```

- [ ] **Step 2: Add `FileText` import and research badge to `ProjectPage.tsx`**

Open `web/src/pages/ProjectPage.tsx`. Find the lucide-react import line:

```typescript
import { GitBranch, GitGraph, Video } from 'lucide-react';
```

Replace with:

```typescript
import { FileText, GitBranch, GitGraph, Video } from 'lucide-react';
```

Then, in the overview tab's capabilities section (inside the `{(caps?.has_graph || caps?.has_media || project.repo_path) && ...}` block), add after the `caps?.has_media` badge and before the `project.repo_path` badge:

```tsx
                  {caps?.has_research && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <FileText size={11} className="shrink-0" />
                      research saved
                    </span>
                  )}
```

Also update the capabilities section guard condition to include `has_research`:

```tsx
            {(caps?.has_graph || caps?.has_media || caps?.has_research || project.repo_path) && (
```

- [ ] **Step 3: Run all web tests to confirm nothing broke**

```bash
npm test --prefix web -- --run
```

Expected: all tests PASS.

- [ ] **Step 4: Run all server tests to confirm nothing broke**

```bash
npm test --prefix server -- --run
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useProjectCapabilities.ts web/src/pages/ProjectPage.tsx
git commit -m "feat: wire up Research tab and overview badge for has_research capability"
```
