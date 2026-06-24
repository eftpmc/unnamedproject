# Spaces List & Overview Redesign

**Date:** 2026-06-24  
**Scope:** `web/src/pages/SpacesPage.tsx`, `web/src/pages/SpacePage.tsx` (Overview component only)

---

## Summary

Two related visual simplifications:

1. **SpacesPage** — Replace the grid of heavy SpaceCard components with a simple list consistent with ChatsPage. No per-card API queries, no counts, same row layout and column width.

2. **SpacePage Overview** — Drop stat cards and "Active now" section. Replace with a flat activity list capped at 12 items using the same card-row style.

---

## 1. SpacesPage

### Layout

- Replace `grid` with `flex flex-col gap-2` list inside `ContentColumn` with `max-w-2xl`
- Remove `SpaceCard` component entirely

### Row structure

Each space renders as a single row (not a button-wrapped Surface card):

```
[avatar] [name]          [chevron]
         [description]
```

- **Avatar**: `size-8` rounded square with the space's first letter, `bg-muted text-muted-foreground text-xs font-semibold`
- **Name**: `text-sm font-medium text-foreground`
- **Description**: `text-xs text-faint-fg truncate` — one line, falls back to nothing if null
- **Chevron**: `ChevronRight size={15} text-faint-fg`
- Row container: `flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 transition hover:-translate-y-px hover:border-border hover:shadow-sm cursor-pointer`

### Search

- Always visible — remove the `spaces.length > 4` gate
- Input style matches ChatsPage: full-width search with `Search` icon, `max-w-2xl`

### Header

- `PageHeader` title "Spaces", no description prop
- `actions`: "New Space" button (unchanged)

### Data

- Remove `getSpaceItems`, `getSpacePlans` queries — `SpaceCard` is deleted
- `getChats` query removed from SpacesPage entirely (no chat counts needed)
- Only `getSpaces` query remains

### New Space dialog

Unchanged — same fields (name, description, repo path), same mutation.

### Empty state

Unchanged — `CenteredEmptyState` with "No Spaces yet".

---

## 2. SpacePage Overview

### What's removed

- `Metric` component and the 4-card grid (Items, Chats, Plans, Running)
- "Active now" `PageSection` with `PlanCard` grid
- "Recent activity" section label/wrapper

### What replaces it

A flat activity list — the entire `Overview` body becomes a single `ContentColumn max-w-2xl` with rows:

- Combines chats, items, and plans into one list
- Cap: 12 items total, sorted by time descending (same sort logic as current)
- No per-type slicing — take from all three pools, sort, slice to 12

### Row structure

Matches ChatsPage card style:

```
[icon] [title]                    [status?] [chevron]
       [type · time ago]
```

- Container: `flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 transition hover:-translate-y-px hover:border-border hover:shadow-sm`
- **Icon**: existing `ItemIcon` component (handles Chat, Plan, repo, file, note types)
- **Title**: `text-sm font-medium text-foreground truncate`
- **Subtitle**: `text-xs text-faint-fg` — `{type} · {timeAgo(time)}`
- **Status pill**: kept for plan rows (`StatusPill` component), `null` for others
- **Chevron**: `ChevronRight size={15} text-faint-fg`
- Each row is a `<button type="button">` navigating to `entry.href`

### Empty state

`EmptyPanel` with title "Nothing here yet" and description "Start a chat or add an item to this Space."

### Wrapper

`PageBody` → `ContentColumn max-w-2xl` (replaces current `mx-auto max-w-5xl flex flex-col gap-7`)

### What stays

- `Overview` remains a function component inside `SpacePage.tsx`
- `ItemIcon` component unchanged
- `StatusPill` component unchanged
- `Metric` component can be deleted (no longer used)
- `PlanCard` component stays (used by Plans section tab)
- `PageSection` component stays (used by other tabs)

---

## Out of scope

- SpacePage sub-route tab content (Chats, Items, Plans, Pipelines, Settings sections)
- SpacePage header, breadcrumb, or tab bar
- Any server-side changes
- Deleting spaces from SpacesPage
