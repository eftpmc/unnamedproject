# Navigation Redesign

## Summary

Replace the current two-panel navigation (icon rail + sliding nav panel) with a single, standard sidebar. Rename "sessions" to "chats" throughout. Move the Chats and Projects list views to full pages alongside Settings. Add a `read_chat` agent tool for cross-session context retrieval.

## Layout

The app shell becomes: **sidebar + main content area**. No icon rail.

**Sidebar (~240px, fixed):**
- Top: logo mark + app name
- New chat button (primary, full-width)
- Nav links: Chats, Projects (navigate to their respective pages)
- Spacer
- Recent chats section (label: "Recent", normal weight) — last 5 chats by updated_at, showing title + relative time; clicking navigates directly to that chat
- Bottom: user menu trigger (avatar + username, full-width button) that opens a shadcn `DropdownMenu` upward containing: theme toggle, Settings link

**Main content area (flex-1):**
- Chat view when a chat is active
- Empty state when no chat selected
- Chats page (full list) when Chats nav link is active
- Projects page when Projects nav link is active
- Settings page when Settings is chosen from the user menu

## Renamed: sessions → chats

All user-facing text, routes, and component names change:
- "Sessions" → "Chats"
- `/s/:sessionId` → `/c/:chatId` (with redirect from old routes)
- `SessionView` → `ChatView`
- `NavPanel` removed
- `IconRail` removed

API routes and DB column names stay as-is (`sessions` table, `/api/sessions`) — this is a frontend-only rename.

## New: Chats page

Full-page chat list replacing the NavPanel sessions list. Shows all chats with title, relative time, and a delete action. Mirrors the structure of the Settings page.

## New: Projects page

Full-page projects list. Shows project name, description, repo path. Create / delete actions. Previously this was a stub in the NavPanel.

## Agent tool: read_chat

New tool available to the agent:

```
name: read_chat
description: Retrieve messages from a previous chat. Use when the user references past work or you need context before responding.
input: { chat_id: string }
returns: recent messages from that chat as formatted text
```

The system prompt also injects the last 10 chat titles + timestamps so the agent can see what was recently worked on and decide whether to call `read_chat`.

## Components

| Old | New |
|-----|-----|
| `IconRail` | removed |
| `NavPanel` | removed |
| `AppLayout` | simplified — sidebar + outlet |
| `SessionView` | renamed `ChatView` |
| — | `Sidebar` (new) |
| — | `UserMenu` (new, shadcn DropdownMenu) |
| — | `ChatsPage` (new) |
| `ProjectsEmptyState` | replaced by `ProjectsPage` |

## Out of scope

- DB schema changes (sessions table stays as sessions)
- Auth or API route changes
- Mobile / responsive layout
