# Settings Page Tab Strip: Pill Restyle

## Problem

The global Settings page (`web/src/pages/Settings.tsx`) has its own tab strip (Agents/Tools/MCP/Workspace/Memory/Account) styled with a thin underline indicator. The Space screen's tab strip was recently restyled as high-contrast pills (rounded `bg-muted` track, active tab gets `bg-background` + shadow — see `docs/superpowers/specs/2026-06-25-space-tabs-redesign-design.md` and `web/src/pages/SpacePage.tsx`'s `SpaceTabs`). The two tab strips are now visually inconsistent.

## Scope

In scope:
- `Settings.tsx`'s tab strip (`web/src/pages/Settings.tsx:710-728`) — visual restyle only.

Out of scope (explicitly deferred):
- The `TABS` array, tab order, or any section content — unchanged.
- Folding "Tools" into another tab, or any other content reorganization.
- The per-space Settings tab (`SpacePage.tsx`'s `SettingsSection`) — a different, unrelated screen.
- Mobile overflow handling — `Settings.tsx` already wraps its tab strip in `overflow-x-auto` with a hidden scrollbar (`Settings.tsx:711`); this already-correct behavior is preserved as-is.

## Design

Apply the same pill visual treatment used in `SpaceTabs` to the existing `<button>`-based tab strip in `Settings.tsx`:
- The wrapping `<div>` keeps its `overflow-x-auto` scroll behavior but adopts the pill track: rounded, `bg-muted`, fixed height, small internal padding.
- Each `<button>` keeps its `onClick={() => setTab(t.id)}` behavior; only its `className` changes from the underline pattern (`border-b-2`, `border-primary`/`border-transparent`) to the pill pattern (active: `bg-background text-foreground shadow-sm`; inactive: `text-muted-foreground hover:text-foreground`).
- No change to `TABS`, no change to any `{tab === '...' && (...)}` content block, no change to imports beyond what's already used (`cn` is already imported).

## Testing

- Existing tests in `Settings.test.tsx` are unaffected — they don't assert on the removed underline classes.
- Manual check: tab strip renders as pills, switching tabs still works, mobile overflow scroll still works (no regression from the already-correct existing behavior).

## Non-goals

- No change to tab list, order, or content.
- No change to the per-space Settings tab.
- No new tests required — this is a pure class-level visual change with no new behavior to cover.
