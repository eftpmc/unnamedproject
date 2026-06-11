# Campaigns + UI/UX Redesign

**Date:** 2026-06-11  
**Status:** Approved  
**Scope:** Agent orchestration campaigns as first-class objects; Refined Minimal design overhaul across all screens.

---

## Overview

Two goals in one effort:

1. **Campaigns** — the lead agent can delegate multi-step work across projects to Claude Code, Codex, and MCP tools. These campaigns become persistent, navigable objects with their own status page, discovered through the Project workspace.
2. **UI/UX redesign** — evolve the existing warm minimal aesthetic (Refined Minimal): add structure with cards and color-coded agent states, clean up the chat header, and make the project page a real workspace.

---

## Design System

**Direction:** Refined Minimal. Build on the existing warm off-white palette (`#f5f0eb` background) — don't change the color base.

**Agent state color coding** (applied via border tints and status badges):
- `green` (`#16a34a` / `#d1fae5` bg) — done/complete
- `blue` (`#3b82f6` / `#eff6ff` bg) — running
- `gray` (`#d1d5db`) — waiting / not started
- `amber` (`#f59e0b`) — needs approval

**Surface hierarchy:**
- Page: `bg-[#faf9f7]`
- Card: `bg-white border border-[#e8e3dc] rounded-xl`
- Elevated (modal): standard shadcn dialog

**Typography:** No typeface change. Add weight contrast: `font-semibold` for titles, `text-muted-foreground` for metadata.

**No new accent colors** beyond the agent state palette above.

---

## Navigation & Sidebar

No structural changes to the sidebar. Existing: app name, New chat CTA, Chats nav, Projects nav, recent chats list, user menu at bottom.

**One bug fix:** Projects nav button routes to `/p` which 404s — change to `/projects`.

Campaigns are not a top-level sidebar entry. They are discovered through the Project workspace.

Settings remains accessible only via the user menu dropdown — no sidebar slot needed.

---

## Project Page Redesign

### URL structure
- `/projects` — projects grid (replaces current two-pane layout)
- `/projects/:id` — project workspace with tabs
- `/projects/:id/campaigns` — campaigns tab (deep-linkable)
- `/projects/:id/campaigns/:cid` — campaign detail page
- `/projects/:id/files` — files tab
- `/projects/:id/settings` — settings tab

### Projects list (`/projects`)
Replace the current split-pane (narrow project list left, nearly empty detail right) with a **full-width card grid** in the main content area. Each project card shows: name, type (code repo / doc project), description, campaign count, and a running-indicator dot if any campaign is active.

### Project workspace (`/projects/:id`)
Full-width layout with a header and four tabs. No secondary sidebar.

**Header:**
- Project name (`font-semibold`) + type badge
- Breadcrumb: `Projects / project-name`
- Repo path or doc-project label as subtitle

**Tab: Overview**
- Stats row: campaign count (with "N running" in green if any active), connected MCP tool count, current branch + worktree status
- Most recent campaign card (compact, links to campaign detail)
- "Start a chat about this project" quick-action button (creates new chat with this project pre-pinned)

**Tab: Campaigns**
- List of all campaigns for this project, newest first
- Columns: name, status badge, task count, start time, "from chat" link
- Click a row → campaign detail page

**Tab: Files**
- Existing `FileBrowser` component, moved here as a tab
- No behavior change

**Tab: Settings**
- Project name, description, repo path, enabled MCP connections
- Content moved from the current create/edit modal into this tab (modal remains for project creation only)
- Delete project action at the bottom

---

## Campaign System

### Data model additions

New `campaigns` table:
```sql
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','done','error','cancelled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);
```

`campaign_tasks` table:
```sql
CREATE TABLE campaign_tasks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  agent TEXT NOT NULL,         -- 'claude_code' | 'codex' | 'mcp'
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK(status IN ('waiting','running','done','error')),
  execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
  position INTEGER NOT NULL,   -- display order
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);
```

### Lead agent tool: `create_campaign`

New tool available to the lead agent:

```json
{
  "name": "create_campaign",
  "description": "Create a campaign to track a multi-task delegation. Call this before dispatching multiple invoke_claude_code / invoke_codex / mcp_call tools as part of a coordinated effort. Returns a campaign_id to pass to each subsequent task tool so they are grouped.",
  "input_schema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" },
      "title": { "type": "string", "description": "Short name for this campaign, e.g. 'Auth refactor'" },
      "tasks": {
        "type": "array",
        "description": "Ordered list of planned tasks",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "agent": { "type": "string", "enum": ["claude_code", "codex", "mcp"] }
          },
          "required": ["title", "agent"]
        }
      }
    },
    "required": ["project_id", "title", "tasks"]
  }
}
```

`invoke_claude_code`, `invoke_codex`, and `mcp_call` get an optional `campaign_task_id` parameter so executions are linked to a task row.

The `create_campaign` tool returns `{ campaign_id, project_id }` — both values are stored in `executions.result` (JSON string) so the frontend has what it needs to build the campaign detail URL without an extra fetch.

### Campaign auto-completion

A campaign moves to `done` when all its tasks reach `done`. It moves to `error` if any task errors and none are still running. Completion is computed in the route/service layer, not by the agent.

### Campaign card in chat (UI)

When the lead calls `create_campaign`, the response message renders a **CampaignCard** component (not a generic execution card). It shows:
- Campaign title + status badge
- Task list with colored dots (green/blue/gray) that update live via WebSocket
- "View campaign →" link to `/projects/:id/campaigns/:cid`

The card is embedded inside the assistant message bubble. WebSocket events (`campaign_task_updated`) drive live dot color changes without re-fetching.

**Rendering trigger:** `MessageList` already iterates over executions attached to each message. When an execution has `tool = 'create_campaign'` and `status = 'done'`, it renders `CampaignCard` (parsing `{ campaign_id, project_id }` from `execution.result`) instead of the generic `ExecutionCard`. All other tools continue to render `ExecutionCard`.

### API routes

```
POST   /campaigns                          create campaign
GET    /projects/:id/campaigns             list campaigns for project
GET    /campaigns/:id                      campaign detail + tasks
PATCH  /campaigns/:id/tasks/:tid          update task status (internal use)
```

WebSocket event: `{ type: 'campaign_task_updated', campaignId, taskId, status }`

---

## Chat View Redesign

### Header (replaces current "Chat" plaintext header)
- Left: chat title (editable inline, falls back to "Untitled chat") + pinned project with a status dot (green = agent active, gray = idle)
- Right: effort level chip + model chip (compact, moved from input bar)
- Clicking the project name navigates to the project workspace

### Input bar
- Textarea + send button only
- Effort/model selectors removed from here (moved to header)
- Cleaner, focused on typing

### Execution cards (single tool calls)
- Keep existing collapsible behavior
- Add color-coded left border: `border-l-2 border-blue-400` while running, `border-green-400` when done, `border-red-400` on error
- No other structural change

### Campaign card (in-message)
- New `CampaignCard` component, rendered inside assistant messages
- Compact: title, status badge, task dot list, "View campaign →" CTA
- Task dots update live via WebSocket without message re-render

---

## Bugs Fixed

- `/p` route 404 — Projects nav button should use `/projects`
- Settings page at `/settings` loads the raw API JSON response when accessed directly — needs the React route properly guarded (or is an unrelated direct-URL issue; verify during implementation)

---

## Out of Scope

- Campaign creation by the user directly (UI form) — campaigns are always created by the lead agent
- Campaign cancellation UI (can add later)
- Multi-project campaigns (campaigns are scoped to one project)
- Campaign templates or reusable plans
- File editing from the Files tab (browse-only, matching current behavior)
