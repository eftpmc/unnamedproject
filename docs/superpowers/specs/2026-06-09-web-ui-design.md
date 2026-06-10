# Web UI — Design Spec
**Date:** 2026-06-09
**Scope:** Sub-project 3 — React web client
**Status:** Draft

---

## Overview

A minimal, tool-like web client for the unnamedproject server. The agent is the interface — no dashboards, no kanban. Users send messages, watch work happen in real time, and approve destructive actions. Everything lives in one place.

---

## Design Decisions

| Decision | Choice |
|---|---|
| Layout | Icon rail + collapsible nav panel + main content |
| Aesthetic | Flat dark minimal — pure dark surfaces, sharp edges, muted grays |
| Execution display | Inline pill in thread, collapsed by default, click to expand |
| User-facing term | **Sessions** (server renamed from `threads` as part of this work) |

---

## Visual Language

- **Background:** `#0a0a0a`
- **Surface:** `#0d0d0d` (rail, panels)
- **Card:** `#111111`
- **Border:** `#1a1a1a`
- **Text primary:** `#cccccc`
- **Text secondary:** `#666666`
- **Text muted:** `#444444`
- **Accent active:** `#cccccc` (white border-left on selected item)
- **Running:** `#22c55e` dot
- **Awaiting approval:** `#f59e0b` dot
- **Error:** `#ef4444` dot
- **Done:** `#444444` dot (fades back)
- **Font:** System sans-serif stack
- **Code:** `font-family: monospace`, background `#151515`
- No blur, no gradients, no shadows on cards

---

## Layout

```
┌──────┬─────────────┬─────────────────────────────┐
│ Rail │  Nav panel  │        Main content          │
│ 44px │   180px     │           flex-1             │
│      │ (slides in) │                              │
└──────┴─────────────┴─────────────────────────────┘
```

### Icon Rail (44px, always visible)

Icons top-to-bottom:
1. **Logo mark** — 22×22px placeholder, top
2. **New session** (+ icon) — creates a new session and opens it
3. **Sessions** (chat bubble icon) — opens sessions nav panel
4. **Workspaces** (grid icon) — opens workspaces nav panel

Spacer, then at bottom:
5. **Settings** (gear icon) — navigates to settings page

Active icon has `background: #1e1e1e` and uses `#cccccc` stroke. Inactive uses `#555555` stroke.

### Nav Panel (180px, visible when sessions or workspaces icon is active)

**Sessions panel:**
- Header: "Sessions" label (9px uppercase muted)
- List of sessions ordered by `updated_at` DESC
- Each row: session title (truncated), relative timestamp below
- Active session: `background: #161616`, `border-left: 2px solid #cccccc`
- Hover: `background: #111111`

**Workspaces panel:**
- Header: "Workspaces" label
- List of workspaces: name + description (truncated)
- Below workspaces: "Connections" header + list of connection names + types
- No actions here — workspaces and connections are managed in Settings

### Main Content

Fills remaining width. Renders one of:
- **Session view** — the active conversation
- **Settings view** — full-page settings (replaces main content area, no nav panel)
- **Empty state** — when no session is selected

---

## Session View

### Header (40px, border-bottom)

- Session title (left, `#aaaaaa`, 11px medium)
- Workspace badge (right, `background: #111`, `border: 1px solid #1e1e1e`, 9px) — shows workspace the agent is currently working in, if known

### Message Thread

Scrollable. Messages are bottom-anchored (new messages appear at bottom).

**User message:**
- Right-aligned bubble
- `background: #161616`, `border: 1px solid #222222`
- `border-radius: 8px 8px 2px 8px`
- Max-width 70% of thread

**Assistant message:**
- Left-aligned, no bubble
- Label: "Assistant" in `#555555`, 9px, above message
- Message text in `#bbbbbb`, 10px, `line-height: 1.6`
- Execution cards appear below the message text they relate to

### Execution Cards

Appear inline after the assistant message that triggered them.

**Collapsed (default):**
```
● invoke_claude_code · api workspace          ▾
```
- Full-width pill: `background: #111`, `border: 1px solid #1e1e1e`, `border-radius: 5px`, `padding: 6px 10px`
- Status dot (left), tool name + workspace name (flex-1, muted), expand chevron (right)
- Click anywhere to expand

**Expanded:**
- Header row stays (chevron flips to ▴)
- Output area below header: `font-family: monospace`, 9px, `color: #555555`, `line-height: 1.6`, `padding: 8px 10px`, `background: #0d0d0d`
- Output streams in live via WebSocket; auto-scrolls to bottom
- "Done" state: dot fades to `#444444`
- "Error" state: dot turns `#ef4444`, output area gets `border-top: 1px solid #2a1010`

**Agent-auto-approved actions** (invoke_claude_code, invoke_codex, git commit):
- Same pill as above
- No Approve/Reject buttons — label shows `auto` badge in muted style

**User-approval-required actions** (git push, github writes):
- Dot color: `#f59e0b`
- Right side shows inline Approve / Reject buttons instead of chevron
- Approve: `background: #0f1f0f`, `border: 1px solid #1a3a1a`, `color: #4ade80`, 9px
- Reject: `background: #111`, `border: 1px solid #222`, `color: #555555`, 9px
- After decision: buttons replaced by "Approved" or "Rejected" label, dot color updates

### Input Area (bottom, border-top)

- `padding: 10px 12px`
- Single input row: `background: #111`, `border: 1px solid #1e1e1e`, `border-radius: 7px`, `padding: 8px 12px`
- Placeholder: "Message…" in `#444444`
- Send button: right-aligned arrow icon, `color: #444444`, brightens on hover
- Submit on Enter (Shift+Enter for newline)
- Disabled while agent is processing (input grays out, send arrow muted)

---

## Settings View

Replaces main content when settings icon is active. Nav panel hides.

Four sections rendered as a scrollable single page with section headers:

### Connections
- List of existing connections: name, type badge, created date
- "Add connection" button: opens an inline form below the list
  - Fields: Name, Type (select: anthropic / openai / github / mcp), Config (JSON textarea, monospace)
  - Submit / Cancel
- Delete icon on each row (confirm before deleting)

### Workspaces
- List of workspaces: name, description, repo path
- "Add workspace" button: inline form
  - Fields: Name, Description, Repo path, Enabled connections (multi-select from existing connections)
  - Submit / Cancel
- Delete icon on each row

### Memory
- Read-only table: Key | Value
- Populated from `GET /memory` (returns all key-value pairs for the authenticated user)
- No editing in v1 — view only

### Account
- Email display
- "Sign out" button

---

## Empty State

When no session is selected and no session exists:
- Centered in main content area
- Short text: "Start a session" with a muted description
- "New session" button

---

## New Session Flow

1. User clicks + icon in rail (or "New session" button in empty state)
2. A new session is created via `POST /sessions`
3. Session view opens with empty message list and focused input
4. Title is set from the first user message (truncated to 40 chars) after the agent responds

---

## WebSocket Integration

Client connects on login with `?token=<jwt>`. Events handled:

| Event | Action |
|---|---|
| `message_created` | Append message to thread if active session matches |
| `execution_update` (status) | Update execution card status/dot |
| `execution_update` (chunk) | Append chunk to expanded output area |
| `approval_requested` | Swap execution card to approval mode (amber dot + Approve/Reject) |
| `action_auto_approved` | Show brief flash on execution card (agent approved) |

---

## Auth

- JWT stored in `localStorage`
- On load: if no token → show login screen (email + password form, full-screen centered)
- On 401 from any API call → clear token, redirect to login
- No registration UI in the client (first user registers via API; subsequent users only if `ALLOW_REGISTRATION=true`)

---

## Routes (React Router)

```
/login            Login screen
/                 Redirects to /s (last active session or empty state)
/s                Empty state (no session selected)
/s/:sessionId     Active session view
/settings         Settings page
```

---

## API Integration

All requests include `Authorization: Bearer <jwt>`.

| UI action | API call |
|---|---|
| Load session list | `GET /sessions` |
| Open session | `GET /sessions/:id/messages` |
| Send message | `POST /sessions/:id/messages` |
| New session | `POST /sessions` |
| Approve action | `POST /executions/:id/approve` |
| Reject action | `POST /executions/:id/reject` |
| Load workspaces | `GET /workspaces` |
| Load connections | `GET /connections` |
| Add workspace | `POST /workspaces` |
| Delete workspace | `DELETE /workspaces/:id` |
| Add connection | `POST /connections` |
| Delete connection | `DELETE /connections/:id` |
| Load user memory | `GET /memory` (new endpoint, added as part of this work) |

---

## Server-side Rename

The server currently uses `threads` everywhere (table name, route paths, WebSocket events, variable names). As part of this work, rename all of these to `sessions`:

- SQLite table: `threads` → `sessions`
- Routes: `/threads` → `/sessions`, `/threads/:id/messages` → `/sessions/:id/messages`
- WebSocket events: `message_created` stays, execution/approval events unchanged — only thread-specific references renamed
- All TypeScript types, variable names, and comments in `server/src/`
- Test files updated to match

The rename is mechanical — no behavior changes.

---

## Out of Scope (v1)

- Session search or filtering
- Session rename
- Session delete
- Markdown rendering in messages (plain text only)
- File attachments
- Light mode
- Mobile responsiveness
- Voice input (iOS only, deferred)
