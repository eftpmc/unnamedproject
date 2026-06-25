# Space Screens Redesign: Pill Tabs, Persistent Header, Empty-Doc Fix

## Problem

The Space screen's tab strip (`Chats / Items / Plans / Pipelines / Settings`) uses a thin underline style with low contrast, making it hard to notice as navigation. A separate, unused pill-style `Tabs` component already exists in `web/src/components/ui/tabs.tsx` but nothing in the app uses it.

Additionally:
- Navigating to a non-Overview tab inserts a single, isolated breadcrumb link (the space name) above the page heading that doesn't appear on Overview — an inconsistent, half-finished piece of navigation.
- A document-type item with the default single empty text block renders a fully blank body instead of the existing "no content yet" empty-state message, because the empty-state check only looks at `blocks.length === 0` rather than whether all blocks are empty.

## Scope

In scope:
- `SpaceTabs` component in `web/src/pages/SpacePage.tsx` (visual style + new Overview entry)
- `SpacePage`'s header region (space name display, description, breadcrumb removal)
- `Overview` section content (drop duplicate space-name heading)
- Item detail empty-state check in `SpacePage.tsx` / `BlockRenderer.tsx`

Out of scope (explicitly deferred):
- Settings page's own tab bar (`Settings.tsx`) — will be reworked separately
- Item detail's own breadcrumb ("Items → item name") — correct as-is
- The unused `ui/tabs.tsx` Radix component itself — not adopted directly (see Approach below); remains unused after this change unless a future pass wires it up elsewhere

## Approach

Extract the **visual treatment** of the pill tabs (the Tailwind classes from `tabsListVariants` / `TabsTrigger` in `ui/tabs.tsx` — rounded `bg-muted` track, active item gets `bg-background` + shadow) and apply it directly to the existing `<Link>`-based `SpaceTabs` nav in `SpacePage.tsx`, rather than wrapping the nav in the Radix `Tabs`/`TabsTrigger` primitives.

Rejected alternatives:
- **Wrap route links in Radix `Tabs` via `asChild`** — gets the same pill styling plus built-in keyboard arrow-key navigation, but Radix `Tabs` is a controlled-value widget designed for client-side tab switching, not URL navigation; fighting its activation model for what's fundamentally a row of route links adds complexity without real benefit here.
- **Leave `SpaceTabs` as-is, restyle only Settings' tab bar** — doesn't fix the low-contrast tabs bug that motivated this work.

## Design

### 1. Tab strip (`SpaceTabs`)

- Add `Overview` as the first tab, linking to `/spaces/:spaceId` (today's implicit root).
- Restyle the tab row as pills: rounded container with muted background track; the active tab gets a distinct background + subtle shadow; inactive tabs are plain text on the track. Mirrors `ui/tabs.tsx`'s `default` variant visually, implemented as plain Tailwind classes on the existing `<Link>` elements (no Radix Tabs primitive involved).
- `aria-current="page"` on the active link is preserved.

### 2. Persistent header

- The header above the tab strip always shows just the space name (no per-tab page title like "Items" or "Plans" underneath, and no breadcrumb link).
- The "New chat" action button stays in this header, shown on every tab except Settings (unchanged from today).
- The one-line space description (e.g. "Everything related to this work, in one place.") is removed entirely — not shown on any tab, including Overview.

### 3. Overview content

- Since the space name now lives in the persistent header, the Overview tab's content area no longer repeats it as a heading. Overview becomes just the "recents" list (or the "Nothing here yet" empty state), starting directly below the tab strip.

### 4. Other tabs (Chats, Items, Plans, Pipelines, Settings)

- Each tab's content area drops its own bold section heading (e.g. "Items"). The highlighted pill in the tab strip communicates which section is active; no heading is duplicated in the body.
- Settings tab content/behavior is otherwise unchanged (its own internal tab bar is out of scope).

### 5. Item detail empty-state fix

- In `SpacePage.tsx`'s `ItemDetail` (document content check) and/or `BlockRenderer.tsx`, change the empty-state condition from `item.blocks.length === 0` to a check that treats a set of all-empty/blank blocks as empty too.
- When all blocks are empty, show the existing message: "This document has no content yet. Ask the agent to fill it in." Non-empty blocks continue to render via `BlockRenderer` exactly as today.

## Testing

- Existing tests in `SpacePage.test.tsx` cover tab navigation and section rendering — update assertions that currently expect the breadcrumb link or per-tab headings, and add a case for the new Overview tab link/route.
- Add a test for the item-detail empty-state fix: a document with a single empty text block should render the "no content yet" message, not a blank body.
- Manual check (already done ad hoc via Playwright during design): tab strip contrast, Overview tab navigation, persistent header on all tabs, empty-doc message.

## Non-goals

- No change to Settings' own tab bar styling or behavior.
- No change to the item detail page's own breadcrumb.
- No introduction of the Radix `Tabs` primitive into the app in this pass.
