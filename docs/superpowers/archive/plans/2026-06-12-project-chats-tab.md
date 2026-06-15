# Project Chats Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chats tab to the project page that lists all chat sessions pinned to that project.

**Architecture:** Reuse the already-cached `['chats']` React Query result (fetched by the sidebar), filter client-side by `pinned_project_id === projectId`, and render a divided-row list inside `ProjectPage.tsx`. No server changes.

**Tech Stack:** React, TypeScript, TanStack Query, React Router, Tailwind CSS, Vitest + React Testing Library

---

### Task 1: Add Chats tab — tests then implementation

**Files:**
- Modify: `web/src/pages/ProjectPage.test.tsx`
- Modify: `web/src/pages/ProjectPage.tsx`

- [ ] **Step 1: Add `getChats` to the API mock in the test file**

Open `web/src/pages/ProjectPage.test.tsx`. Add `getChats` to the `vi.mock('../lib/api.js', ...)` factory. The mock returns two sessions — one pinned to `proj-1`, one pinned elsewhere:

```typescript
vi.mock('../lib/api.js', () => ({
  getProjects: vi.fn().mockResolvedValue([
    {
      id: 'proj-1',
      name: 'Test Project',
      description: null,
      repo_path: null,
      enabled_connection_ids: [],
    },
  ]),
  getProjectCampaigns: vi.fn().mockResolvedValue([]),
  getProjectCapabilities: vi.fn().mockResolvedValue({ has_remotion: false, has_media: false }),
  getChats: vi.fn().mockResolvedValue([
    {
      id: 'chat-1',
      title: 'Fix the render bug',
      effort: 'normal',
      model: null,
      pinned_project_id: 'proj-1',
      created_at: Date.now() - 3600_000,
      updated_at: Date.now() - 3600_000,
    },
    {
      id: 'chat-2',
      title: 'Other project chat',
      effort: 'normal',
      model: null,
      pinned_project_id: 'proj-other',
      created_at: Date.now() - 7200_000,
      updated_at: Date.now() - 7200_000,
    },
  ]),
  createChat: vi.fn(),
  updateChatConfig: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
}));
```

- [ ] **Step 2: Write three failing tests**

Append these three tests inside the existing `describe('ProjectPage', ...)` block in `web/src/pages/ProjectPage.test.tsx`:

```typescript
it('shows the Chats tab', async () => {
  renderPage('/projects/proj-1');
  expect(await screen.findByRole('tab', { name: /Chats/ })).toBeInTheDocument();
});

it('shows only chats pinned to this project in the Chats tab', async () => {
  renderPage('/projects/proj-1/chats');
  expect(await screen.findByText('Fix the render bug')).toBeInTheDocument();
  expect(screen.queryByText('Other project chat')).not.toBeInTheDocument();
});

it('shows empty state when no chats are pinned to this project', async () => {
  const { getChats } = await import('../lib/api.js');
  (getChats as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
  renderPage('/projects/proj-1/chats');
  expect(await screen.findByText('No chats yet')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd /path/to/project && npm test --prefix web -- --run ProjectPage
```

Expected: the three new tests FAIL (tab not found, chat text not found, empty state not found). The two existing tests should still PASS.

- [ ] **Step 4: Add imports to `ProjectPage.tsx`**

At the top of `web/src/pages/ProjectPage.tsx`, make these two changes:

1. Add `getChats` to the api import line:
```typescript
import { getProjects, getProjectCampaigns, getProjectCapabilities, createChat, updateChatConfig, deleteProject, updateProject, getChats } from '../lib/api.js';
```

2. Add `Session` to the types import line:
```typescript
import type { Project, Campaign, Session } from '../types.js';
```

- [ ] **Step 5: Add the chats query inside `ProjectPage`**

In `web/src/pages/ProjectPage.tsx`, inside the `ProjectPage` component function, add this query after the existing `campaigns` query:

```typescript
const { data: allChats = [] } = useQuery<Session[]>({
  queryKey: ['chats'],
  queryFn: getChats,
  staleTime: 30_000,
});
const pinnedChats = allChats.filter(c => c.pinned_project_id === projectId);
```

- [ ] **Step 6: Add the Chats entry to the TABS array**

In `ProjectPage.tsx`, find the `TABS` array definition. Insert the Chats entry between Campaigns and Files:

```typescript
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: `Campaigns${campaigns.length > 0 ? ` (${campaigns.length})` : ''}` },
  { id: 'chats', label: `Chats${pinnedChats.length > 0 ? ` (${pinnedChats.length})` : ''}` },
  { id: 'files', label: 'Files' },
  ...extraTabs.map(t => ({ id: t.id, label: t.label })),
  { id: 'settings', label: 'Settings' },
];
```

- [ ] **Step 7: Add the Chats tab content block**

In `ProjectPage.tsx`, inside the `<div className="flex-1 overflow-y-auto">` that holds all tab content, add this block immediately after the `{tab === 'campaigns' && ...}` block:

```tsx
{tab === 'chats' && (
  <div className="max-w-4xl p-4 sm:p-6">
    {pinnedChats.length === 0 ? (
      <EmptyPanel
        title="No chats yet"
        description="Start a chat from this project and it will appear here."
      />
    ) : (
      <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60">
        {pinnedChats.map((chat, i) => (
          <button
            key={chat.id}
            onClick={() => navigate(`/c/${chat.id}`)}
            className={cn(
              'flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors',
              i < pinnedChats.length - 1 && 'border-b border-border/50',
            )}
          >
            <span className="text-sm font-medium truncate">
              {chat.title ?? 'Untitled chat'}
            </span>
            <span className="shrink-0 ml-3 text-xs text-muted-foreground">
              {timeAgo(chat.updated_at)}
            </span>
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 8: Run tests to confirm all pass**

```bash
npm test --prefix web -- --run ProjectPage
```

Expected: all 5 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/pages/ProjectPage.tsx web/src/pages/ProjectPage.test.tsx
git commit -m "feat: add Chats tab to project page"
```
