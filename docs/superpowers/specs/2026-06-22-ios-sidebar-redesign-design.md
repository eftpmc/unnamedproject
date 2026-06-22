# iOS Sidebar Redesign — adapted from web

**Date:** 2026-06-22
**Status:** Approved design, pending implementation plan
**Scope:** `mobile/ios/Unnamed/` — presentation + navigation only. No server, model, or API changes.

## Goal

Bring the iOS sidebar into line with the web app's sidebar (the source of
truth: `web/src/components/Sidebar.tsx`) and clean up several rough edges in the
current iOS implementation (`SidebarViewController.swift`).

## Problems with the current iOS sidebar

- Brand logo + title live in the table header as a stacked block that reads
  awkwardly.
- A custom **X** close button occupies the top-left nav slot; it's a redundant
  dismiss control layered on top of the split view.
- A hairline divider under the header adds visual weight web doesn't have.
- Inbox appears twice: as a nav row *and* as a bell in a bottom toolbar.
- Account is a small avatar tucked into the top-right nav bar.
- Tapping search docks a `UISearchController` field as a **new row** below the
  nav bar — a jarring layout shift.
- The sidebar carries the entire date-grouped chat history rather than a lean
  recent list like web.

## Target layout (iPhone, at rest)

```
┌─────────────────────────────┐
│ u  unnamed          🔍  🔔②  │   ← nav bar: brand in left slot, search + inbox right
├ (no hairline) ───────────────┤
│  [      + New chat        ]  │   ← full-width primary pill
│                              │
│  💬  Chats                   │   ← nav rows
│  ▦  Projects                 │
│                              │
│  Recent                      │   ← section label
│   • Untitled chat   just now │   ← up to 5; active chat gets a pulsing dot
│     Remotion Window  1d ago  │
│     …(up to 5, no trailing link)
│                              │
│            (spacer)          │
├─────────────────────────────┤
│  T  thelegitblitz            │   ← full-width account row, pinned bottom
└─────────────────────────────┘
```

## Changes

1. **Brand → top-left nav slot.** Move the `u` chip + "unnamed" wordmark out of
   the table header and into the navigation bar's left bar-button slot (where the
   X used to be). The stacked header block is removed.
2. **Remove the X / close control.** Delete `closeButton`,
   `updateCloseButtonVisibility`, and the `onClose` callback. The sidebar is the
   navigation root (see Navigation model); there is nothing to dismiss to.
3. **Remove hairline dividers.** No separator under the header and none above the
   footer account row.
4. **Inbox bell → top-right nav bar** beside search, with the approval-count
   badge rendered inline on the bell. Delete `setupToolbar`, the bottom toolbar
   bell, and the separate **Inbox** nav row.
5. **Account → full-width bottom row.** Replace the top-right avatar bar button
   with a footer row showing avatar + email/name, pinned to the bottom, tappable
   to open Settings.
6. **Inline search.** Tapping 🔍 expands a search field along the top line,
   covering the brand, with a Cancel control. Typing filters the chat list in
   place (reusing the existing filter logic — when searching, show all matches
   rather than the Recent-5 cap). Cancel collapses back to the brand line. No
   docked second row.
7. **Recent capped at 5.** The sidebar shows only the 5 most recent chats under a
   "Recent" label, with no "See all" link.
8. **Nav rows: Chats + Projects.** "Chats" opens the full-history Chats screen
   (below); "Projects" unchanged.

## New: Chats screen

Add a `ChatsViewController` (pushed from the **Chats** nav row) presenting the
full chat history: date-grouped (Today / Yesterday / Last 7 days / …) and
searchable — i.e. the behavior the sidebar used to carry. This becomes the home
for "all chats." Reuses existing `client.sessions()`, `activeSessions()`,
time-grouping, and project-name decoration already in `SidebarViewController`.

## Navigation model

- **iPhone (collapsed split view):** the sidebar is the **root/top column**.
  Launch lands on the sidebar. Selecting a chat shows the conversation pushed on
  top; the system back chevron returns to the sidebar. The chat screen's custom
  `sidebar.left` bar button is suppressed while collapsed so the system back
  chevron is used instead.
- **iPad (expanded split view):** the sidebar remains a persistent column beside
  the chat. The chat's `sidebar.left` button continues to toggle the column open
  and closed. Brand-in-nav-slot, footer account row, and the inline search behave
  identically.

To make the sidebar the collapsed root, the split view returns `.primary` as the
top column when collapsing (via the split view delegate /
`preferredDisplayMode`), and the launch flow no longer forces the chat
(secondary) to the front on iPhone.

## Out of scope

- No data, model, or API changes.
- Projects, Settings, and Inbox (Approvals) destination screens are unchanged;
  only the entry points and their placement move.
- No change to the chat screen beyond suppressing its custom sidebar button when
  the split view is collapsed.

## Design notes / accepted tradeoffs

- **Launch lands on the sidebar**, not a chat. This follows the chosen root
  model (Mail/Messages pattern). If a chat-first launch is later preferred, the
  most recent chat can be auto-pushed onto the sidebar root.
- **Chats nav row** is the single path to full history; the redundant "See all"
  link from web is intentionally dropped.
