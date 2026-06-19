# iOS App UI/UX Redesign — Design

**Date:** 2026-06-19
**Status:** Approved design, pending implementation plan
**Scope:** Full redesign of the `mobile/ios` UIKit app — navigation model, chat rendering, and all screens.

## Problem

The iOS app is a hub-and-spoke dashboard. The user lands on `DashboardViewController` — a marketing-style hero ("What should keep moving?" + subtitle), a composer, three large stacked action cards (Inbox / Chats / Projects), and duplicated Recent + Projects lists. Every destination is a `pushViewController` off that single screen, so there is no persistent navigation and no fast way to move between chats. The result feels unstructured and un-iOS-native, and it diverges sharply from the web app.

The web app, by contrast, is **chat-first**: it boots straight into a chat (`/c`), with a persistent sidebar for history and navigation, an inbox slide-over, and secondary pages for Chats/Projects/Settings.

Separately, the chat screen renders **both** user and assistant turns as bubbles (`MessageCell`), which is not how modern AI chat apps (ChatGPT, Claude) present assistant output.

## Goals

- Adopt a **chat-first** model inspired by the web app, implemented with **native iOS conventions** (UINavigationController, system materials, SF Symbols, sheets, inset-grouped lists, large titles).
- Replace the dashboard hub with: **chat as the root screen** + a **slide-over sidebar** for history and navigation (the ChatGPT/Claude iOS idiom, which is also what the web uses on mobile).
- Fix chat rendering: **user messages are bubbles; the assistant reply is full-width** markdown on the canvas (no bubble), with inline tool chips and code blocks.
- Redesign **all** screens for visual coherence: chat, sidebar, projects, project detail, inbox/approvals, settings, connect/login.
- Preserve all existing functionality and the existing API/WebSocket contract (no server changes).

## Non-Goals

- No server/API/WebSocket protocol changes. The redesign uses existing endpoints in `APIClient` and existing `WSEvent`s.
- No new product features (no starring/pinning UI beyond what exists, no search backend work — client-side filtering only).
- No change to auth/session model in `AppSession`.

## Design Principles

1. **Chat is home.** The app opens into a chat (or a new-chat empty state). Everything else is reachable from there without losing the conversation.
2. **Native iOS, web-inspired.** Take the web's information architecture; render it with stock iOS components and behaviors. No custom-cloning web markup.
3. **Quiet and roomy.** Hairline dividers, generous spacing, full-width tappable rows with system press states. No heavy card borders or all-caps section labels. (Removes the uppercase "CHATS" label in `ProjectDetailViewController` and matches the recent web change dropping uppercase headers.)
4. **One warm palette.** Keep the existing warm canvas/ink palette in `AppTheme` for brand continuity, expressed through native structure.

## Navigation Architecture

**Root:** A chat screen (`ChatViewController`) is the root of the navigation stack. On launch, it opens the most recent chat, or a new-chat empty state if there are none.

**Navigation bar (chat root):**
- **Left:** sidebar button (`line.3.horizontal` / `sidebar.left`) → presents the slide-over sidebar.
- **Center:** current chat title, tappable → chat-scope / model sheet (existing scope concept from web's `ScopePopover`).
- **Right:** compose button (`square.and.pencil`) → starts a new chat.

**Slide-over sidebar** (new `SidebarViewController` + a custom presentation/container, since UIKit ships no drawer): a panel covering ~84% width over a dimmed scrim, opened by the sidebar button or an edge-pan gesture, dismissed by tap-scrim / drag / swipe. Contents, top to bottom:
1. **Search field** — pinned at top; client-side filter over chat titles (and project names).
2. **New chat** — full-width primary row.
3. **Projects** and **Inbox** (with approval badge) — list rows. Projects pushes the projects list; Inbox presents the inbox sheet.
4. **Recents** — chat history grouped by time (Today / Yesterday / Previous 7 Days / Older), most-recent first; the active chat shows a pulsing green dot. Tapping a chat swaps the root chat and dismisses the sidebar. Swipe-to-delete uses the existing `deleteSession` endpoint.
5. **Account row** — pinned to the bottom: avatar + email; tap (or its gear) opens Settings.

**Replaced:** `DashboardViewController` is removed entirely; `AppCoordinator` is restructured around the chat root + sidebar instead of dashboard-centric push flows. Approval notification scheduling currently living in the dashboard moves to a shared place still subscribed to `WebSocketService` (so badges/notifications survive regardless of which screen is showing).

## Screen Designs

### Chat (root + pushed)
- Native nav bar as above. Same canvas background.
- **Message list** (`UITableView`):
  - **User turn:** bubble, right-aligned, `AppTheme.primary` fill — unchanged.
  - **Assistant turn:** **full-width, no bubble** — markdown rendered directly on the canvas (reuse `markdownAttributedString` / segment parsing), with code blocks as full-width monospace blocks and inline tool events as quiet chips/rows (reuse `ToolEventCell`, restyled to sit inline rather than in a bordered pill).
- Existing behaviors preserved: optimistic send, WebSocket streaming (`messageDelta`/`messageStarted`/`executionUpdate`), agent status bar, reconnect banner, polling fallback, long-press copy/share, haptics.
- Empty state: "Start the conversation" centered, with the composer below.

### Sidebar
As described in Navigation Architecture. New component. Search and time-grouping are client-side over `client.sessions()`.

### Projects (`ProjectsViewController`)
- Large-title "Projects", inset-grouped list. Each row: folder icon, project name, repo path (or "No repo linked") as subtitle, chevron.
- Tapping pushes Project detail.

### Project detail (`ProjectDetailViewController`)
- Title = project name. Header shows description + repo path (monospace).
- **Segmented control:** Chats / Plans / Files (Chats is the implemented tab; Plans/Files are placeholders consistent with the web routes, shown as "coming soon" empty states until wired).
- Chats tab: inset-grouped list of chats scoped to the project (`pinnedProjectId == project.id`), active chat shows pulse dot.
- "New chat in project" action (reuses `createSession` + `pinSessionToProject`). Gear in nav bar for project settings (placeholder).
- Removes the uppercase "CHATS" header.

### Inbox / Approvals (`ApprovalsViewController`)
- Presented as a **native detented sheet** (`.medium`/`.large`) over the current chat, instead of a pushed screen.
- List of pending approvals: action title, source chat + relative time, the command/file/prompt (`ApprovalPayload.summary` / `displayPairs`) in a monospace block, and **Approve / Deny** buttons inline.
- Tapping a row pushes the existing `ApprovalDetailViewController` for full payload.
- Live updates via `approvalRequested` / `executionUpdate` WS events; badge clears through the existing `.approvalBadgeCleared` notification.

### Settings (`SettingsViewController`)
- Inset-grouped form: **Account** (avatar + email), **Server** (address + "Change server"), **Notifications** (approval alerts toggle), and a destructive **Sign out**.

### Connect / Login (`ConnectViewController`, `LoginViewController`)
- Flow unchanged. Restyled to match: centered brand mark, native form fields (`FormTextField`), primary button. These remain the pre-auth entry points in `AppCoordinator.start()`.

## Visual System

- **Palette:** existing `AppTheme` (warm canvas/surface/ink, blue accent, orange warning) retained.
- **Structure:** native inset-grouped lists and forms, large titles where appropriate, SF Symbols, system blur on bars, sheet detents, system press/selection states.
- **Typography:** Dynamic Type throughout (already largely in place via `preferredFont`).
- **No all-caps labels;** hairline dividers; rounded-continuous corners.

## Data & Behavior Notes

- Uses only existing `APIClient` endpoints: `me`, `sessions`, `createSession`, `messages`, `sendMessage`, `pendingApprovals`, `approveExecution`, `rejectExecution`, `activeSessions`, `deleteSession`, `pinSessionToProject`, `projects`.
- Uses existing `WSEvent`s (including the recently extended `executionUpdate` with `executionId`/`chunk`/`result`).
- Time grouping reuses/extends `relativeTime`.
- Approval notifications + app badge logic move out of `DashboardViewController` into a shared owner subscribed to `WebSocketService` so they work from the chat root.

## Migration / Removal

- **Remove:** `DashboardViewController`.
- **Add:** `SidebarViewController` + a slide-over container/presentation (and an edge-pan gesture).
- **Restructure:** `AppCoordinator` to root on chat + sidebar; relocate approval-notification ownership.
- **Modify:** `ChatViewController` (`MessageCell` assistant rendering → full-width; restyle `ToolEventCell` inline), `ProjectsViewController`, `ProjectDetailViewController` (segmented control, drop uppercase label), `ApprovalsViewController` (sheet presentation), `SettingsViewController` (grouped form), `ConnectViewController`/`LoginViewController` (restyle).

## Testing

- Manual verification in Simulator across: cold launch (no chats → empty state; with chats → most recent), sidebar open/dismiss (button + edge-pan + drag), chat switching, new chat (root and in-project), streaming a turn (deltas, tool chips, full-width assistant), approval arriving while in a chat (badge + sheet + approve/deny), projects list/detail, settings, sign-out, and connect/login.
- Dynamic Type sizes (XS → XXL) and dark mode on each screen.
- WebSocket reconnect banner and polling fallback still function on the chat root.

## Future / Out of Scope

- Pinned/starred chats above "Today".
- Server-backed chat search.
- Plans/Files tabs in Project detail (wired to real data).
- Project settings screen.
