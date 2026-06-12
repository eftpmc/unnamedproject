# Project Overview Redesign — Design Spec

**Date:** 2026-06-12
**Status:** Approved

## Goal

Redesign the ProjectPage Overview tab from a minimal stat-card layout into a rich status dashboard — the primary surface for understanding what the orchestrator has built and what's happening in the sandbox project. Modelled on Vercel's project overview: the overview tells you everything at a glance; campaign/chat tabs become full-history deep-dives.

## Architecture

No new API calls. All data is already fetched by ProjectPage:
- `campaigns` — from `getProjectCampaigns`
- `pinnedChats` — from `getChats` filtered by `pinned_project_id`
- `project.enabled_connection_ids` — from the project object
- `caps` — from `getProjectCapabilities`

The overview tab content in `ProjectPage.tsx` is restructured. No new components, no server changes.

## Layout (top to bottom)

### 1. Active Campaign (hero)

Derived: `const activeCampaign = campaigns.find(c => c.status === 'running') ?? null`

**When a campaign is running:**
- Slightly larger card with a blue left border accent (`border-l-2 border-blue-500`) to draw the eye
- Title at `text-sm font-semibold`
- "running" badge (blue, existing `STATUS_BADGE` colours)
- `Started {timeAgo(activeCampaign.created_at)}` in muted text
- Entire card is a `<Link>` to `/projects/${projectId}/campaigns/${activeCampaign.id}`

No progress bar — task data requires a separate fetch and is shown on the campaign page itself.

**When nothing is running:**
- Section heading still shows; content collapses to `recentCampaign` (existing `campaigns[0]`) rendered as a smaller card with its status badge — identical to today's "Recent campaign" card.

**When no campaigns exist:**
- Section is hidden entirely; show `<EmptyPanel>` at the bottom of the overview (existing behaviour).

### 2. Stats row

Three cards in a `grid grid-cols-3` (or `grid-cols-1 sm:grid-cols-3` for mobile):

| Card | Value | Sub-label |
|---|---|---|
| Campaigns | `campaigns.length` | `{runningCampaigns.length} running` (if > 0, blue) |
| Chats | `pinnedChats.length` | — |
| MCP Tools | `project.enabled_connection_ids.length` | — |

Each card: `Surface` component, `p-4`, label at `text-xs text-muted-foreground`, number at `text-2xl font-semibold`.

### 3. Recent Campaigns

Header row: `"Recent Campaigns"` label left + `<Link to={tabHref(projectId, 'campaigns')}>View all →</Link>` right (indigo, `text-xs`).

List: `campaigns.slice(0, 3)` in a rounded border container (existing table-container style). Each row:
- Left: campaign title (`text-sm font-medium`)
- Right: status badge + `timeAgo` separated by a gap
- Entire row: `<Link>` to the campaign page
- Rows divided by `divide-y divide-border/50`

Hidden entirely when `campaigns.length === 0`.

### 4. Recent Chats

Header row: `"Recent Chats"` label left + `<Link to={tabHref(projectId, 'chats')}>View all →</Link>` right.

List: `pinnedChats.slice(0, 2)`. Each row:
- Left: `chat.title ?? 'Untitled chat'` (`text-sm font-medium`)
- Right: `timeAgo(chat.updated_at)` (`text-xs text-muted-foreground`)
- Entire row: `<button onClick={() => navigate('/c/${chat.id}')}>`
- Rows divided by `divide-y divide-border/50`

Hidden entirely when `pinnedChats.length === 0`.

### 5. Capabilities

Unchanged from today — badge row for `has_graph`, `has_media`, and any future capabilities. Moved to the bottom of the overview.

Also show repo path here if `project.repo_path` is set (moved from the stat cards):
```tsx
{project.repo_path && (
  <span className="flex items-center gap-1.5 ...">
    <GitBranch size={11} />
    {project.repo_path.split('/').pop()}
  </span>
)}
```

Hidden entirely when no capabilities are detected and no repo path.

## Empty State

When `campaigns.length === 0` and `pinnedChats.length === 0`, render `<EmptyPanel>` below the stats row:
```
title="Nothing here yet"
description="Start a chat and ask the orchestrator to get to work. Campaigns and activity will appear here."
```

## Tab Structure

All existing tabs remain unchanged. The Campaigns and Chats tabs become full-history views that the overview's "View all →" links navigate to.

## Files Changed

| File | Change |
|---|---|
| `web/src/pages/ProjectPage.tsx` | Restructure the `{tab === 'overview' && ...}` block only. No changes to other tabs, queries, or imports beyond removing the repo stat card (repo moves to capabilities row). |
