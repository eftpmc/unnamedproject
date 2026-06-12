# UI Consistency: Headers, Responsiveness, and Layout

**Date:** 2026-06-12  
**Scope:** Chat, Project, Settings screens — header unification, responsive cleanup, hairline removal

---

## Problem

The three main screens have structurally different headers:
- **Settings** — uses `PageShell` + `PageHeader` (the correct pattern)
- **Chat** — hand-rolled `<header>` tag with its own padding, border, and flex layout
- **Project** — fully custom block: breadcrumb + title row + tabs, no shared primitives

This causes inconsistent visual chrome, different padding rhythms, and fragile responsive behavior across screens.

---

## Design

### 1. Remove the decorative hairline

In `web/src/pages/AppLayout.tsx` line 53, remove:
```tsx
<div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
```
It floats at the top of the content pane with no structural alignment and creates a visual artifact.

---

### 2. Unified `PageHeader` across all screens

All three screens adopt the same `PageHeader` component from `ui/app-layout.tsx`. The component already has the right shape: `min-h-14`, `border-b border-border/40`, `px-4 sm:px-6`, title + optional description + optional actions.

**Chat (`ChatView.tsx`):**
- Title: chat name (or "Untitled chat")
- Description: pinned project name (if set), with the status dot
- Actions: a single compact pill button — "medium · Claude Sonnet 4.6" — that opens a `DropdownMenu` or `Popover` containing the effort segmented control and model select
- Remove the existing `<header>` tag and replace with `<PageHeader>`
- The worktree banner (branch/merge bar) stays beneath `PageHeader` as a separate `shrink-0` strip, unchanged

**Project (`ProjectPage.tsx`):**
- Remove the entire hand-rolled header block (breadcrumb + title row)
- Use `PageShell` wrapping the whole page
- `PageHeader` with: title = project name, description = project description + repo path (one line, truncated), actions = "Start chat" button
- Tabs strip moves immediately below `PageHeader`, inside the `PageShell` — same left padding (`px-4 sm:px-6`), no extra wrapper div
- The breadcrumb is removed (redundant given sidebar navigation)

**Settings (`Settings.tsx`):**
- Already uses `PageHeader` but with several overrides: `size="page"` (2xl title), `border-b-0`, `sm:px-8` (wider than standard), and custom `pt-6 sm:pt-8` top padding
- Change to match standard: remove `size="page"` (so title is compact 15px like chat/project), restore `border-b`, normalize padding to `px-4 sm:px-6`
- Section titles (`PageSection`) remain sentence-case — no changes needed

---

### 3. Responsive cleanup

Standardize across all three screens:
- Horizontal padding: `px-4 sm:px-6` everywhere (header, body, tab strip)
- Chat header: on narrow viewports, the pill wraps below the title naturally via the `PageHeader` flex-wrap — no separate mobile layout needed
- Project tab strip: `overflow-x-auto` so tabs scroll horizontally on small screens rather than wrapping or clipping
- Settings tools grid: already `grid-cols-1 md:grid-cols-3` — no change needed

---

### 4. `PageHeader` component — minor update

Add `flex-wrap` to the header's inner layout so actions can wrap on narrow viewports without overflowing:
```tsx
className={cn(
  'flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border/40 px-4 py-3 sm:px-6',
  className,
)}
```
(Currently `flex-wrap` is absent — `gap-4` already handles spacing, wrap prevents overflow.)

---

### 5. Chat model/effort popover

A new `ChatConfigPopover` component replaces the two `Select` elements in `ChatView.tsx`:
- Trigger: a single `Button variant="ghost"` pill showing `"{effort} · {model display name}"` with a chevron-down icon
- Content: a `Popover` containing an effort toggle (low / medium / high as a segmented button group) and a model `Select` below it
- Popover closes on selection
- Behavior is identical to current — same API calls, same `configMutation`

---

## Files changed

| File | Change |
|---|---|
| `web/src/pages/AppLayout.tsx` | Remove hairline div |
| `web/src/components/ui/app-layout.tsx` | Add `flex-wrap` to `PageHeader` |
| `web/src/components/ChatView.tsx` | Replace `<header>` with `PageHeader`; extract `ChatConfigPopover` |
| `web/src/pages/ProjectPage.tsx` | Replace custom header block with `PageShell` + `PageHeader`; clean tab strip |
| `web/src/pages/Settings.tsx` | Normalize `PageHeader` padding overrides |

---

## Out of scope

- Chat auto-titling (separate bug)
- Files tab content (separate feature)
- Campaign page (already uses `PageHeader` correctly)
- New features of any kind
