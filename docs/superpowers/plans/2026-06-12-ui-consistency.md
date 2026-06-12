# UI Consistency: Headers, Responsiveness, Hairline Removal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the headers of the chat, project, and settings screens to use the shared `PageHeader` component, clean up responsiveness, and remove the floating decorative hairline.

**Architecture:** All three screens adopt `PageShell` + `PageHeader` from `ui/app-layout.tsx`. The chat screen gets a new `ChatConfigPopover` component replacing the two loose `Select` elements. Project and settings screens are refactored to match. No new routes, no new API calls.

**Tech Stack:** React 19, TypeScript, Tailwind v4, shadcn/ui components, Radix UI primitives, Vitest + Testing Library

---

## File Map

| File | Action | What changes |
|---|---|---|
| `web/src/pages/AppLayout.tsx` | Modify | Remove decorative hairline div |
| `web/src/components/ui/app-layout.tsx` | Modify | Add `flex-wrap` to `PageHeader` |
| `web/src/components/ui/popover.tsx` | Create | Shadcn-style Popover wrapper around Radix primitive |
| `web/src/components/ChatView.tsx` | Modify | Replace `<header>` with `PageHeader`; replace two Selects with `ChatConfigPopover` |
| `web/src/pages/ProjectPage.tsx` | Modify | Replace custom header block with `PageShell` + `PageHeader`; standardize tab strip + content padding |
| `web/src/pages/Settings.tsx` | Modify | Remove `size="page"`, `border-b-0`, and custom padding overrides from `PageHeader` and `PageBody` |

---

## Task 1: Remove the hairline and fix `PageHeader` wrapping

**Files:**
- Modify: `web/src/pages/AppLayout.tsx`
- Modify: `web/src/components/ui/app-layout.tsx`

- [ ] **Step 1: Remove the hairline div from AppLayout**

In `web/src/pages/AppLayout.tsx`, delete line 53:
```tsx
// DELETE this line:
<div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
```

The file should look like this after (showing the `SidebarInset` block):
```tsx
<SidebarInset className="relative min-h-0 min-w-0 overflow-hidden bg-background/58 backdrop-blur">
  <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-background/70 px-4 backdrop-blur md:hidden">
    <div className="flex items-center gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background shadow-sm">
        u
      </div>
      <span className="text-sm font-semibold">unnamed</span>
    </div>
    <SidebarTrigger
      aria-label="Open navigation"
      className="size-9 rounded-xl border border-border/60 bg-background/80 text-foreground shadow-xs"
    />
  </div>
  {mainContent}
</SidebarInset>
```

- [ ] **Step 2: Add `flex-wrap` to `PageHeader` in app-layout.tsx**

In `web/src/components/ui/app-layout.tsx`, update the `PageHeader` `<header>` className from:
```tsx
className={cn(
  'flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border/40 px-4 py-3 sm:px-6',
  className,
)}
```
to:
```tsx
className={cn(
  'flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border/40 px-4 py-3 sm:px-6',
  className,
)}
```

- [ ] **Step 3: Start the dev server and verify visually**

```bash
cd /path/to/project && npm run dev
```

Open `http://localhost:5173`. The very top of the main content pane should have no thin gradient line. Navigate to chat, projects, settings — confirm no hairline anywhere.

- [ ] **Step 4: Run the test suite to confirm no regressions**

```bash
npm test --prefix web
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/AppLayout.tsx web/src/components/ui/app-layout.tsx
git commit -m "fix: remove decorative hairline and add flex-wrap to PageHeader"
```

---

## Task 2: Create the Popover UI component

**Files:**
- Create: `web/src/components/ui/popover.tsx`

The `radix-ui` package (already installed) exports `Popover` as a namespace. This task creates a thin shadcn-style wrapper, matching the pattern of `dropdown-menu.tsx`.

- [ ] **Step 1: Write the Popover component**

Create `web/src/components/ui/popover.tsx`:
```tsx
import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 rounded-xl border border-border/50 bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build --prefix web 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors related to `popover.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/popover.tsx
git commit -m "feat: add Popover UI component wrapping Radix primitive"
```

---

## Task 3: Unify the chat header

**Files:**
- Modify: `web/src/components/ChatView.tsx`

Replace the hand-rolled `<header>` with `PageHeader`, and replace the two `Select` elements with a `ChatConfigPopover` that opens a popover with both controls.

- [ ] **Step 1: Update imports in ChatView.tsx**

Replace the existing import block at the top of `web/src/components/ChatView.tsx`. Add the new imports and remove unused ones:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, GitMerge } from 'lucide-react';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import { getMessages, sendMessage, getChats, updateChatConfig, getModelsForEffort, getSessionWorktree, mergeSessionBranch, getProjects } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '../lib/utils.js';
import type { EffortLevel, Message, MessageExecution, Session, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved, WSSessionTitleUpdated, WSAgentError, ClaudeModelInfo } from '../types.js';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PageHeader } from '@/components/ui/app-layout';
```

- [ ] **Step 2: Replace the `<header>` block with `PageHeader`**

In `web/src/components/ChatView.tsx`, find the `return` statement of `ChatView`. Replace the `<header>...</header>` block (everything from `<header className=...` through `</header>`) with:

```tsx
<PageHeader
  title={chat?.title ?? 'Untitled chat'}
  description={pinnedProject ? (
    <button
      onClick={() => navigate(`/projects/${pinnedProject.id}`)}
      className="flex w-fit max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      title={`Open ${pinnedProject.name}`}
    >
      <span className={cn(
        'size-1.5 shrink-0 rounded-full',
        agentActive ? 'bg-success' : 'bg-muted-foreground/40',
      )} />
      <span className="truncate">{pinnedProject.name}</span>
    </button>
  ) : undefined}
  actions={
    <ChatConfigPopover
      effort={effort}
      model={chat?.model ?? null}
      models={models}
      onConfigChange={(config) => configMutation.mutate(config)}
    />
  }
/>
```

- [ ] **Step 3: Add the `ChatConfigPopover` component**

Add this function at the bottom of `web/src/components/ChatView.tsx`, before the closing of the file (after `EmptyChatState`):

```tsx
function ChatConfigPopover({
  effort,
  model,
  models,
  onConfigChange,
}: {
  effort: EffortLevel;
  model: string | null;
  models: ClaudeModelInfo[];
  onConfigChange: (config: { effort?: EffortLevel; model?: string | null }) => void;
}) {
  const currentModel = models.find(m => m.id === model);
  const label = `${effort} · ${currentModel?.display_name ?? 'Auto'}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 rounded-lg border border-border/50 bg-muted/70 px-3 text-xs font-normal"
        >
          {label}
          <ChevronDown size={11} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-3">
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Effort</div>
            <div className="flex gap-1">
              {(['low', 'medium', 'high'] as EffortLevel[]).map(o => (
                <Button
                  key={o}
                  size="sm"
                  variant={effort === o ? 'default' : 'ghost'}
                  className="h-7 flex-1 text-xs"
                  onClick={() => onConfigChange({ effort: o })}
                >
                  {o}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Model</div>
            <Select
              value={model ?? 'auto'}
              onValueChange={value => onConfigChange({ model: value === 'auto' ? null : value })}
            >
              <SelectTrigger size="sm" className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                {models.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
npm run build --prefix web 2>&1 | grep -E "error TS|Error" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 5: Visual check in the browser**

Open `http://localhost:5173` and navigate to any chat. Confirm:
- The chat header uses the same height/border/padding as other screens
- The pill shows "medium · Claude Sonnet 4.6" (or current settings)
- Clicking the pill opens a popover with effort buttons (low/medium/high) and a model dropdown
- Selecting effort or model updates the pill label and triggers the API call
- The pinned project link (if any) shows as the description line below the title

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ChatView.tsx
git commit -m "feat: unify chat header using PageHeader and ChatConfigPopover"
```

---

## Task 4: Unify the project page header

**Files:**
- Modify: `web/src/pages/ProjectPage.tsx`

Replace the custom header block with `PageShell` + `PageHeader`. Standardize tab strip and content padding.

- [ ] **Step 1: Update imports in ProjectPage.tsx**

Replace the app-layout import line:
```tsx
// Before:
import { EmptyPanel, PageLoading, PageShell, Surface } from '@/components/ui/app-layout';

// After:
import { EmptyPanel, PageHeader, PageLoading, PageShell, Surface } from '@/components/ui/app-layout';
```

Replace the lucide import — `FolderGit2` and `FileText` are used only in the old custom header, which is removed:
```tsx
// Before:
import { FolderGit2, FileText, GitBranch } from 'lucide-react';

// After:
import { GitBranch } from 'lucide-react';
```

Delete the unused `Breadcrumb` imports entirely:
```tsx
// DELETE these lines:
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
```

- [ ] **Step 2: Replace the top-level `<div>` and custom header block**

In `ProjectPage`'s return, replace the entire outer structure. Currently it starts with:
```tsx
return (
  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    {/* Header */}
    <div className="border-b border-border/40 bg-background/60 px-6 pt-4 pb-0">
      ...breadcrumb, title row, tabs...
    </div>
    {/* Tab content */}
    <div className="flex-1 overflow-y-auto">
      ...
    </div>
  </div>
);
```

Replace it with:
```tsx
return (
  <PageShell>
    <PageHeader
      title={project.name}
      description={[project.description, project.repo_path].filter(Boolean).join(' · ') || undefined}
      actions={
        <Button
          size="sm"
          className="h-8 text-xs"
          onClick={() => startChatMutation.mutate()}
          disabled={startChatMutation.isPending}
        >
          Start chat
        </Button>
      }
    />
    {/* Tab strip */}
    <div className="shrink-0 overflow-x-auto border-b border-border/40 px-4 sm:px-6">
      <Tabs value={tab} onValueChange={value => navigate(tabHref(project.id, value as Tab))}>
        <TabsList variant="line" className="-mx-1 px-1">
          {TABS.map(t => (
            <TabsTrigger key={t.id} value={t.id} className="px-3 py-2 text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
    {/* Tab content */}
    <div className="flex-1 overflow-y-auto">
      {tab === 'overview' && (
        <div className="max-w-4xl p-4 sm:p-6">
          {/* Stats */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Surface className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Campaigns</div>
              <div className="text-2xl font-semibold">{campaigns.length}</div>
              {runningCampaigns.length > 0 && (
                <div className="text-xs text-blue-600 font-medium mt-0.5">{runningCampaigns.length} running</div>
              )}
            </Surface>
            <Surface className="p-4">
              <div className="text-xs text-muted-foreground mb-1">MCP tools</div>
              <div className="text-2xl font-semibold">
                {project.enabled_connection_ids.length}
              </div>
            </Surface>
            {project.repo_path && (
              <Surface className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Repo</div>
                <div className="flex items-center gap-1.5 mt-1">
                  <GitBranch size={12} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground truncate">{project.repo_path.split('/').pop()}</span>
                </div>
              </Surface>
            )}
          </div>
          {recentCampaign && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">Recent campaign</div>
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
          )}
          {campaigns.length === 0 && (
            <EmptyPanel
              title="No campaigns yet"
              description="When a chat delegates multi-step work, campaign progress will appear here."
            />
          )}
        </div>
      )}

      {tab === 'campaigns' && (
        <div className="max-w-4xl p-4 sm:p-6">
          {campaigns.length === 0 ? (
            <EmptyPanel
              title="No campaigns yet"
              description="Campaigns are created when the agent coordinates multi-step work for this project."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map(c => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/projects/${projectId}/campaigns/${c.id}`)}
                    >
                      <TableCell className="font-medium">
                        <Link to={`/projects/${projectId}/campaigns/${c.id}`} className="hover:underline">
                          {c.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[c.status])}>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {timeAgo(c.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {tab === 'files' && (
        <div className="p-4 sm:p-6">
          <FileBrowser projectId={projectId!} />
        </div>
      )}

      {tab === 'settings' && (
        <div className="p-4 sm:p-6 max-w-lg">
          <ProjectSettingsForm project={project} onDelete={() => deleteMutation.mutate()} />
        </div>
      )}
    </div>
  </PageShell>
);
```

- [ ] **Step 3: Verify it compiles**

```bash
npm run build --prefix web 2>&1 | grep -E "error TS|Error" | head -20
```

Expected: no TypeScript errors. If there are unused import errors for `Breadcrumb*` components, they were already removed in Step 1.

- [ ] **Step 4: Visual check**

Open `http://localhost:5173/projects`. Click any project. Confirm:
- The header matches the same height/border/padding as the chat and settings headers
- Title is the project name, description line shows description + repo path
- "Start chat" button is on the right
- Tabs sit just below the header, flush with the same left edge
- Tabs scroll horizontally on narrow viewports (resize browser to ~400px wide)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ProjectPage.tsx
git commit -m "feat: unify project page header using PageShell and PageHeader"
```

---

## Task 5: Normalize the settings header

**Files:**
- Modify: `web/src/pages/Settings.tsx`

Settings already uses `PageShell` + `PageHeader` + `PageBody`, but overrides them with custom sizing and padding. This task removes those overrides so Settings matches the other screens exactly.

- [ ] **Step 1: Update the `PageHeader` call in Settings.tsx**

Find:
```tsx
<PageHeader
  title="Settings"
  description="Connect agents, tools, workspaces, and local memory."
  size="page"
  className="border-b-0 px-4 pb-0 pt-6 sm:px-8 sm:pt-8"
/>
```

Replace with:
```tsx
<PageHeader
  title="Settings"
  description="Connect agents, tools, workspaces, and local memory."
/>
```

- [ ] **Step 2: Update the `PageBody` call in Settings.tsx**

Find:
```tsx
<PageBody className="px-4 pt-0 sm:px-8">
```

Replace with:
```tsx
<PageBody>
```

- [ ] **Step 3: Verify it compiles and check visually**

```bash
npm run build --prefix web 2>&1 | grep -E "error TS|Error" | head -20
```

Open `http://localhost:5173/settings`. Confirm:
- Header height and padding matches chat and project screens
- Title "Settings" is the same 15px semibold as other headers (not 2xl)
- Standard border-b separator is present below the header
- Section content is padded consistently (default `PageBody` padding: `px-4 py-5 sm:px-6 sm:py-6`)

- [ ] **Step 4: Run the full test suite**

```bash
npm test --prefix web
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Settings.tsx
git commit -m "fix: normalize Settings PageHeader and PageBody to standard pattern"
```
