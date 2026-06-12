# Project Overview Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the ProjectPage Overview tab into a rich status dashboard with an active-campaign hero, a three-card stat row (Campaigns / Chats / MCP Tools), inline recent campaigns and chats with "View all →" links, and a capabilities row at the bottom.

**Architecture:** All data is already fetched by ProjectPage — no new queries or server changes. The change is purely a restructure of the `{tab === 'overview' && ...}` JSX block in `ProjectPage.tsx`. A new `activeCampaign` derived value is added alongside the existing `runningCampaigns` and `recentCampaign` derivations.

**Tech Stack:** React, TypeScript, TanStack Query, React Router, Tailwind CSS, Vitest + React Testing Library

---

### Task 1: Add failing tests for the new overview layout

**Files:**
- Modify: `web/src/pages/ProjectPage.test.tsx`

- [ ] **Step 1: Append four new tests to the existing `describe('ProjectPage', ...)` block**

Open `web/src/pages/ProjectPage.test.tsx`. Inside the existing `describe` block, after the last test, add:

```typescript
it('shows active campaign hero when a campaign is running', async () => {
  const { getProjectCampaigns } = await import('../lib/api.js');
  (getProjectCampaigns as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      id: 'camp-1',
      project_id: 'proj-1',
      session_id: null,
      title: 'Implement auth flow',
      status: 'running' as const,
      created_at: Date.now() - 300_000,
      completed_at: null,
    },
  ]);
  renderPage('/projects/proj-1');
  expect(await screen.findByText('Active Campaign')).toBeInTheDocument();
  expect(screen.getByText('Implement auth flow')).toBeInTheDocument();
});

it('shows recent campaigns section with campaign title on overview', async () => {
  const { getProjectCampaigns } = await import('../lib/api.js');
  (getProjectCampaigns as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      id: 'camp-2',
      project_id: 'proj-1',
      session_id: null,
      title: 'Add dark mode',
      status: 'done' as const,
      created_at: Date.now() - 3600_000,
      completed_at: Date.now() - 1800_000,
    },
  ]);
  renderPage('/projects/proj-1');
  expect(await screen.findByText('Recent Campaigns')).toBeInTheDocument();
  expect(screen.getByText('Add dark mode')).toBeInTheDocument();
});

it('shows recent chats section on overview when chats are pinned', async () => {
  renderPage('/projects/proj-1');
  expect(await screen.findByText('Recent Chats')).toBeInTheDocument();
  expect(screen.getByText('Fix the render bug')).toBeInTheDocument();
});

it('shows nothing here yet empty panel when no campaigns and no chats', async () => {
  const { getChats } = await import('../lib/api.js');
  (getChats as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
  renderPage('/projects/proj-1');
  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to confirm the four new tests fail**

```bash
npm test --prefix web -- --run ProjectPage
```

Expected: the four new tests FAIL. The existing 5 tests should still PASS.

---

### Task 2: Implement the new overview layout

**Files:**
- Modify: `web/src/pages/ProjectPage.tsx:110-224`

- [ ] **Step 1: Add the `activeCampaign` derived value**

In `ProjectPage.tsx`, find these two lines (around line 110):

```tsx
  const runningCampaigns = campaigns.filter(c => c.status === 'running');
  const recentCampaign = campaigns[0] ?? null;
```

Replace with:

```tsx
  const runningCampaigns = campaigns.filter(c => c.status === 'running');
  const recentCampaign = campaigns[0] ?? null;
  const activeCampaign = runningCampaigns[0] ?? null;
```

- [ ] **Step 2: Replace the entire overview tab content block**

Find and replace the entire `{tab === 'overview' && (...)}` block (currently lines ~152–224). Replace it with:

```tsx
        {tab === 'overview' && (
          <div className="max-w-4xl p-4 sm:p-6 flex flex-col gap-5">
            {/* 1. Active campaign hero */}
            {activeCampaign ? (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Active Campaign</div>
                <Link
                  to={`/projects/${projectId}/campaigns/${activeCampaign.id}`}
                  className="block rounded-xl border-l-2 border-blue-500 border border-border/50 bg-background/55 p-4 transition-colors hover:bg-background/85"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{activeCampaign.title}</span>
                    <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[activeCampaign.status])}>
                      {activeCampaign.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Started {timeAgo(activeCampaign.created_at)}
                  </div>
                </Link>
              </div>
            ) : recentCampaign ? (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Recent Campaign</div>
                <Link
                  to={`/projects/${projectId}/campaigns/${recentCampaign.id}`}
                  className="block rounded-xl border border-border/50 bg-background/55 p-4 transition-colors hover:border-border hover:bg-background/85"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{recentCampaign.title}</span>
                    <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[recentCampaign.status])}>
                      {recentCampaign.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Started {timeAgo(recentCampaign.created_at)}
                  </div>
                </Link>
              </div>
            ) : null}

            {/* 2. Stats row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Surface className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Campaigns</div>
                <div className="text-2xl font-semibold">{campaigns.length}</div>
                {runningCampaigns.length > 0 && (
                  <div className="text-xs text-blue-600 font-medium mt-0.5">{runningCampaigns.length} running</div>
                )}
              </Surface>
              <Surface className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Chats</div>
                <div className="text-2xl font-semibold">{pinnedChats.length}</div>
              </Surface>
              <Surface className="p-4">
                <div className="text-xs text-muted-foreground mb-1">MCP Tools</div>
                <div className="text-2xl font-semibold">{project.enabled_connection_ids.length}</div>
              </Surface>
            </div>

            {/* 3. Recent campaigns */}
            {campaigns.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-muted-foreground">Recent Campaigns</div>
                  <Link
                    to={tabHref(project.id, 'campaigns')}
                    className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
                  >
                    View all →
                  </Link>
                </div>
                <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/50">
                  {campaigns.slice(0, 3).map(c => (
                    <Link
                      key={c.id}
                      to={`/projects/${projectId}/campaigns/${c.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm font-medium truncate">{c.title}</span>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[c.status])}>
                          {c.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Recent chats */}
            {pinnedChats.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-muted-foreground">Recent Chats</div>
                  <Link
                    to={tabHref(project.id, 'chats')}
                    className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
                  >
                    View all →
                  </Link>
                </div>
                <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/50">
                  {pinnedChats.slice(0, 2).map(chat => (
                    <button
                      key={chat.id}
                      onClick={() => navigate(`/c/${chat.id}`)}
                      className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <span className="text-sm font-medium truncate">{chat.title ?? 'Untitled chat'}</span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">{timeAgo(chat.updated_at)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 5. Capabilities */}
            {(caps?.has_graph || caps?.has_media || project.repo_path) && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Capabilities</div>
                <div className="flex flex-wrap gap-2">
                  {caps?.has_graph && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <GitGraph size={11} className="shrink-0" />
                      graph indexed
                    </span>
                  )}
                  {caps?.has_media && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <Video size={11} className="shrink-0" />
                      videos rendered
                    </span>
                  )}
                  {project.repo_path && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <GitBranch size={11} className="shrink-0" />
                      {project.repo_path.split('/').pop()}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 6. Empty state */}
            {campaigns.length === 0 && pinnedChats.length === 0 && (
              <EmptyPanel
                title="Nothing here yet"
                description="Start a chat and ask the orchestrator to get to work. Campaigns and activity will appear here."
              />
            )}
          </div>
        )}
```

- [ ] **Step 3: Run tests to confirm all 9 pass**

```bash
npm test --prefix web -- --run ProjectPage
```

Expected: all 9 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ProjectPage.tsx web/src/pages/ProjectPage.test.tsx
git commit -m "feat: richer project overview — hero campaign, recent campaigns/chats inline, capabilities row"
```
