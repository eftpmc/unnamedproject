# Sidebar Simplification & Space Tab Navigation

**Date:** 2026-06-24  
**Scope:** `web/src/components/Sidebar.tsx`, `web/src/pages/SpacePage.tsx`

---

## Summary

Two related changes:

1. **Sidebar** — Remove space-specific modes. The sidebar is always the same regardless of where the user has navigated. Spaces are a nav destination, not a sidebar context.

2. **SpacePage** — Add a persistent tab bar (Chats · Items · Plans · Pipelines · Settings) below the page header. Overview remains the default landing screen at `/spaces/{id}` with no active tab; clicking a tab navigates to the corresponding sub-route.

---

## 1. Sidebar Simplification

### What changes

- **Header**: Remove the `SpaceSwitcher` conditional. Always render the `[u] unnamed` logo regardless of current route.
- **Content**: Remove the `SpaceNavigation` conditional. Always render `GlobalNavigation` (Chats + Spaces nav items) followed by the recent chats list.
- **Logic removed**: `activeSpace`, `activeSpaceId`, `spaceMatch`, `spaceById` variables; the `activeSpace ?` branch in both header and content.
- **Components deleted**: `SpaceSwitcher`, `SpaceNavigation`.
- **Imports removed**: `ChevronDown`, `CircleGauge`, `FileStack`, `ListTodo`, `Settings2`, `Workflow` from lucide-react; `Space` type import (if no longer used); `updateChatConfig` if only used for space-pinning on new chat — check first.

### What stays

- `getSpaces` query — kept because recent chat rows show the space name as a subtitle (`space.name` in the chat row metadata).
- `GlobalNavigation` — unchanged (Chats and Spaces nav items).
- Recent chats list — always shown when chats exist (currently gated on `!activeSpace`; remove that gate).
- Footer (bell/inbox, UserMenu, reconnecting banner, API key warning) — untouched.

### Behaviour

The sidebar never changes shape. A user inside a space sees the same sidebar as a user on the chat landing. Navigation into and out of spaces happens via the main content area and breadcrumbs, not the sidebar.

---

## 2. SpacePage Tab Navigation

### Tab bar

A horizontal tab bar renders below the `PageHeader` on every SpacePage route. Tabs:

| Label | Route |
|---|---|
| Chats | `/spaces/{id}/chats` |
| Items | `/spaces/{id}/items` |
| Plans | `/spaces/{id}/plans` |
| Pipelines | `/spaces/{id}/pipelines` |
| Settings | `/spaces/{id}/settings` |

Overview (`/spaces/{id}`) is the default landing — no tab is active when the user is on the overview. All five tabs are always visible.

### Placement

Tab bar sits between the `PageHeader` and the section content. It is shown on all sections including Overview (nothing highlighted there).

### Active state

The active tab is determined by `section` (already derived from `sectionFromPath`). When `section === 'overview'`, no tab is active.

### Implementation

- Add a `SpaceTabs` component inside `SpacePage.tsx` that renders the tab bar using the existing `section` value and `spaceId`.
- Use `Link` elements styled as tabs (consistent with the existing design system) so navigation is handled by the router.
- No new routes needed — sub-routes already exist.

### Overview metric cards

The existing metric cards (Items, Chats, Plans, Running) currently navigate to sub-routes on click. With the tab bar present, these `onClick` handlers become redundant navigation — keep them as a secondary affordance (clicking the stat still drills in), but they are no longer the primary way to reach sub-sections.

---

## Out of scope

- SpacePage content changes (overview layout, flat activity list redesign) — separate work.
- Mobile-specific sidebar behaviour beyond what the existing `useSidebar` / offcanvas handles.
- Removing or consolidating sub-route page content.
