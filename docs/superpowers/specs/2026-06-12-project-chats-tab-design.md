# Project Chats Tab — Design Spec

**Date:** 2026-06-12  
**Status:** Approved

## Goal

Add a Chats tab to the project page that shows all chat sessions pinned to that project, so users can navigate back to prior conversations from within the project view.

## Architecture

No server changes required. The `/sessions` endpoint already returns `pinned_project_id` on every session, and the sidebar already fetches all sessions under `queryKey: ['chats']`. The project page reuses this cached query and filters client-side.

## Data Flow

1. `ProjectPage` calls `useQuery({ queryKey: ['chats'], queryFn: getChats })` — same key as the sidebar, so no extra network request.
2. Filter: `chats.filter(c => c.pinned_project_id === projectId)`.
3. Count drives the tab label and is passed into the `TABS` array.

## Tab

- **Position:** Between Campaigns and Files in the `TABS` array.
- **Label:** `Chats (N)` when N > 0, `Chats` when 0 — matching the Campaigns tab convention.
- **Always visible:** shown regardless of count so users always have a place to look.

## UI

Divided-row list inside a rounded border (`border border-border/50 rounded-xl bg-background/60`), matching the Campaigns table container style.

Each row:
- Full row is a clickable `<button>` → `navigate('/c/<id>')`
- Left: `title ?? 'Untitled chat'` at `text-sm font-medium`
- Right: `timeAgo(updated_at)` at `text-xs text-muted-foreground`
- Hover: subtle background shift via Tailwind `hover:bg-muted/30`
- No arrow glyph — row hover is the affordance

Empty state: `<EmptyPanel title="No chats yet" description="Start a chat from this project and it will appear here." />`

## Files Changed

| File | Change |
|---|---|
| `web/src/pages/ProjectPage.tsx` | Add `getChats` import, `['chats']` query, filtered chats, Chats tab entry, tab content block |

No new files. No server changes.

## Out of Scope

- Deleting chats from this view (use the global Chats page)
- Unpinning a chat from a project from this view
- Sorting or searching chats
