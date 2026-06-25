# Space Screens Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Space tab strip as high-contrast pills (including a new Overview tab), collapse the per-tab header into one persistent space-name header with no breadcrumb/description, and fix the item-detail empty-state check that currently renders a blank page for a document made of empty blocks.

**Architecture:** All changes live in `web/src/pages/SpacePage.tsx` (the `SpaceTabs` component, the main `SpacePage` render, and `DocumentDetail`), plus one shared route addition. No new files, no new dependencies — pure restyle + logic fix in an existing component using the project's existing Tailwind/`cn()` conventions. The unused Radix `Tabs` primitive in `ui/tabs.tsx` is referenced only as a styling guide, not imported.

**Tech Stack:** React, react-router-dom (`Link`, `useLocation`), Vitest + React Testing Library, Tailwind CSS, `cn()` helper from `web/src/lib/utils.ts`.

## Global Constraints

- Settings' own internal tab bar (`web/src/pages/Settings.tsx:710-728`) is out of scope — do not touch it.
- Item detail's two-level breadcrumb ("Items → item name", `SpacePage.tsx:616-622`) is out of scope — do not touch it.
- Do not import or instantiate the Radix `Tabs`/`TabsList`/`TabsTrigger` primitives from `ui/tabs.tsx` — copy only the visual Tailwind treatment onto the existing `<Link>`-based nav.
- Preserve `aria-current="page"` on the active tab link — existing tests assert on it.

---

## File Structure

| File | Change |
|---|---|
| `web/src/pages/SpacePage.tsx` | `SpaceTabs` gets an `Overview` entry (linking to the existing `/spaces/:spaceId` route, no new route needed — `sectionFromPath` already resolves that path to `'overview'`) + pill styling; main `SpacePage` render drops per-tab title/description/breadcrumb in favor of one persistent header; `DocumentDetail` empty-state check is fixed. |
| `web/src/pages/SpacePage.test.tsx` | Update mocked items to include a document fixture, add Overview tab test, persistent-header tests, and empty-document test. |

No new files are created. No routing changes in `web/src/App.tsx` — the space root path already exists.

---

## Task 1: Add "Overview" as an explicit tab in `SpaceTabs`

**Files:**
- Modify: `web/src/pages/SpacePage.tsx:809-838` (`SpaceTabs`)
- Test: `web/src/pages/SpacePage.test.tsx`

**Interfaces:**
- Consumes: existing `Section` type (`SpacePage.tsx:62`): `'overview' | 'chats' | 'items' | 'plans' | 'pipelines' | 'settings'`. `sectionFromPath` (`SpacePage.tsx:64-67`) already returns `'overview'` whenever the path has no recognized suffix — `/spaces/:id` already resolves to `'overview'` today, so no new route is needed.
- Produces: `SpaceTabs` now renders 6 links instead of 5; the first one points at `/spaces/${spaceId}` (no suffix).

Today, visiting `/spaces/space-1` shows the Overview content but the tab strip itself shows no tab as active (none of the 5 `Link`s match `section === tab.key` since `'overview'` isn't one of `tabs`). This task adds a 6th tab so Overview gets its own pill, active when `section === 'overview'`.

- [ ] **Step 1: Write the failing test**

Add to `web/src/pages/SpacePage.test.tsx`, inside the `describe('SpacePage', ...)` block:

```tsx
  it('marks the Overview tab active on the space root route', async () => {
    renderPage('/spaces/space-1');
    expect(await screen.findByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx -t "Overview tab"`
Expected: FAIL — `Unable to find an accessible element with the role "link" and name "Overview"`

- [ ] **Step 3: Add the Overview tab**

In `web/src/pages/SpacePage.tsx`, replace the `tabs` array inside `SpaceTabs` (currently lines 810-816):

```tsx
function SpaceTabs({ spaceId, section }: { spaceId: string; section: Section }) {
  const tabs: { label: string; key: Section }[] = [
    { label: 'Overview', key: 'overview' },
    { label: 'Chats', key: 'chats' },
    { label: 'Items', key: 'items' },
    { label: 'Plans', key: 'plans' },
    { label: 'Pipelines', key: 'pipelines' },
    { label: 'Settings', key: 'settings' },
  ];
```

Update the `to` for the Overview entry so it points at the space root, not `/spaces/${spaceId}/overview` (that route doesn't exist). Replace the `Link` rendering (currently lines 821-823):

```tsx
        {tabs.map(tab => (
          <Link
            key={tab.key}
            to={tab.key === 'overview' ? `/spaces/${spaceId}` : `/spaces/${spaceId}/${tab.key}`}
            aria-current={section === tab.key ? 'page' : undefined}
```

Leave the rest of `SpaceTabs` (the `className` logic and closing tags) unchanged for this step — styling is Task 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx -t "Overview tab"`
Expected: PASS

- [ ] **Step 5: Run the full SpacePage test file to check for regressions**

Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx`
Expected: All tests PASS (the existing "renders the Space overview with tab bar" test only asserts the 5 original links exist via `getByRole`, which still pass since those links are still present — it doesn't assert the *count* of links, so adding a 6th doesn't break it).

- [ ] **Step 6: Commit**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject
git add web/src/pages/SpacePage.tsx web/src/pages/SpacePage.test.tsx
git commit -m "feat(space): add Overview as an explicit tab in the space tab strip"
```

---

## Task 2: Restyle `SpaceTabs` as pills

**Files:**
- Modify: `web/src/pages/SpacePage.tsx` (`SpaceTabs`, after Task 1)
- Test: `web/src/pages/SpacePage.test.tsx` (no new test — this is a pure visual/class change; existing `aria-current` and `getByRole('link', ...)` assertions already cover it)

**Interfaces:**
- Consumes: `tabs` array and `section` prop from Task 1 — unchanged shape.
- Produces: same DOM structure (a `nav[aria-label="Space sections"]` containing `Link`s), only `className` values change. No consumer outside this function depends on the class names.

This copies the pill visual treatment from `web/src/components/ui/tabs.tsx`'s `default` variant (`tabsListVariants` + `TabsTrigger`, currently lines 27-39 and 41-61 of that file) onto the plain `Link` elements, without importing the Radix component.

- [ ] **Step 1: Replace the SpaceTabs render**

Replace the full return statement of `SpaceTabs` in `web/src/pages/SpacePage.tsx` (the `<div className="border-b ...">...</div>` block, currently lines 817-836) with:

```tsx
  return (
    <div className="px-6 py-3">
      <nav
        className="inline-flex h-9 w-fit items-center gap-1 rounded-lg bg-muted p-[3px]"
        aria-label="Space sections"
      >
        {tabs.map(tab => (
          <Link
            key={tab.key}
            to={tab.key === 'overview' ? `/spaces/${spaceId}` : `/spaces/${spaceId}/${tab.key}`}
            aria-current={section === tab.key ? 'page' : undefined}
            className={cn(
              'inline-flex h-full items-center justify-center rounded-md px-3 text-sm font-medium transition-all',
              section === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
```

`cn` is already imported at the top of `SpacePage.tsx` (line 44), so no new import is needed.

- [ ] **Step 2: Run the full SpacePage test file**

Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx`
Expected: All tests PASS (no test asserts on the removed `border-b-2`/underline classes, only on text/role/aria-current).

- [ ] **Step 3: Visually verify with Playwright**

With the dev server running (`localhost:5173`), navigate to `/spaces/<any-space-id>` and confirm the tab strip now renders as a rounded pill track with the active tab showing a distinct background, matching the `default` variant screenshot taken earlier in this conversation (`unused-tabs-variants.png`, top group).

- [ ] **Step 4: Commit**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject
git add web/src/pages/SpacePage.tsx
git commit -m "style(space): restyle space tab strip as high-contrast pills"
```

---

## Task 3: Collapse the per-tab header into one persistent space-name header

**Files:**
- Modify: `web/src/pages/SpacePage.tsx:114-136` (main `SpacePage` render) and the `Overview` function (`SpacePage.tsx:146-182`)
- Test: `web/src/pages/SpacePage.test.tsx`

**Interfaces:**
- Consumes: `space: Space` (has `.name`, `.id`), `section: Section`, `startChat` mutation — all already in scope in `SpacePage`.
- Produces: `PageHeader`'s `title` is now always `space.name` regardless of `section`; `breadcrumb` and `description` props are no longer passed (removed from the call entirely). `Overview` no longer needs a title — it goes straight to the recents list/empty state.

Today (`SpacePage.tsx:114-136`):

```tsx
  const title = section === 'overview' ? space.name : section[0].toUpperCase() + section.slice(1);
  const description = section === 'overview' ? space.description || 'Everything related to this work, in one place.' : undefined;

  return (
    <PageShell>
      <PageHeader
        className="border-0"
        title={title}
        description={description}
        breadcrumb={section === 'overview' ? undefined : (
          <Link to={`/spaces/${space.id}`} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            {space.name}
          </Link>
        )}
        actions={section !== 'settings' ? (
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => startChat.mutate()} disabled={startChat.isPending}>
            <MessageSquare size={14} />
            New chat
          </Button>
        ) : undefined}
      />
      <SpaceTabs spaceId={space.id} section={section} />
      {section === 'overview' && <Overview space={space} items={items} plans={plans} chats={spaceChats} />}
```

- [ ] **Step 1: Write the failing tests**

Add to `web/src/pages/SpacePage.test.tsx`:

```tsx
  it('shows the persistent space-name header on every tab, with no per-tab title or breadcrumb', async () => {
    renderPage('/spaces/space-1/items');
    // Space name appears as the header title on a non-Overview tab.
    expect(await screen.findByRole('heading', { name: 'Test Space' })).toBeInTheDocument();
    // No separate "Items" page title.
    expect(screen.queryByRole('heading', { name: 'Items' })).not.toBeInTheDocument();
    // No breadcrumb link back to the space (the old single stray link).
    expect(screen.queryByRole('link', { name: 'Test Space' })).not.toBeInTheDocument();
  });

  it('does not show the space description anywhere', async () => {
    renderPage('/spaces/space-1');
    expect(screen.queryByText('A useful Space')).not.toBeInTheDocument();
    expect(screen.queryByText('Everything related to this work, in one place.')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx -t "persistent space-name header"`
Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx -t "does not show the space description"`
Expected: Both FAIL — today `Items` renders as the heading (not `Test Space`) on the items route, and the description renders on Overview.

- [ ] **Step 3: Simplify the header**

Replace lines 114-136 of `web/src/pages/SpacePage.tsx` with:

```tsx
  return (
    <PageShell>
      <PageHeader
        className="border-0 pb-0"
        title={space.name}
        actions={section !== 'settings' ? (
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => startChat.mutate()} disabled={startChat.isPending}>
            <MessageSquare size={14} />
            New chat
          </Button>
        ) : undefined}
      />
      <SpaceTabs spaceId={space.id} section={section} />
      {section === 'overview' && <Overview space={space} items={items} plans={plans} chats={spaceChats} />}
```

This removes the `title`/`description` local variables entirely (they're no longer referenced anywhere else in the function — confirm with a search before deleting if unsure, but `title` and `description` were only used in the `PageHeader` call being replaced).

- [ ] **Step 4: Drop the Overview content's duplicate heading**

`Overview` (`SpacePage.tsx:146-182`) currently never rendered a heading itself — it goes straight into `PageBody`/`ContentColumn` with the recents list or `EmptyPanel`. Confirm this by re-reading the function: no change needed here. (The "duplicate heading" was the `PageHeader`'s own `title={title}` which, for Overview, equaled `space.name` — already handled by Step 3 since `title` is now unconditionally `space.name`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject
git add web/src/pages/SpacePage.tsx web/src/pages/SpacePage.test.tsx
git commit -m "fix(space): persistent space-name header, remove breadcrumb and description"
```

---

## Task 4: Fix the item-detail empty-state check for all-empty blocks

**Files:**
- Modify: `web/src/pages/SpacePage.tsx:679-702` (`DocumentDetail`)
- Test: `web/src/pages/SpacePage.test.tsx`

**Interfaces:**
- Consumes: `Block` type from `web/src/types.ts:103` (a discriminated union; the `'text'` variant is `{ type: 'text'; content: string }`).
- Produces: a new local helper `isBlockEmpty(block: Block): boolean`, used only inside `DocumentDetail`. Not exported — no other file needs it.

Today (`SpacePage.tsx:688`): `item.blocks.length === 0 ? <empty-state> : <render blocks>`. A freshly created document has `blocks: [{ type: 'text', content: '' }]` — length 1, so it skips the empty-state and renders the text block, which `BlockRenderer`'s `TextBlock` (`BlockRenderer.tsx:28-29`) correctly returns `null` for, producing a blank page.

- [ ] **Step 1: Write the failing test**

First, update the mocked `getSpaceItems` in `web/src/pages/SpacePage.test.tsx` (lines 9-12) to include a document item with a single empty text block:

```tsx
  getSpaceItems: vi.fn().mockResolvedValue([
    { id: 'repo-1', space_id: 'space-1', type: 'repo', name: 'Web repo', repo_path: '/tmp/web', default_branch: 'main', source_session_id: null, source_plan_id: null, source_step_id: null, created_at: 10 },
    { id: 'note-1', space_id: 'space-1', type: 'note', name: 'Release notes', content: '# Ready', source_session_id: null, source_plan_id: null, source_step_id: null, created_at: 9 },
    { id: 'doc-1', space_id: 'space-1', type: 'document', name: 'Empty Doc', template: 'document', blocks: [{ type: 'text', content: '' }], source_session_id: null, source_plan_id: null, source_step_id: null, created_at: 8 },
  ]),
```

Then add a new test to the `describe('SpacePage', ...)` block:

```tsx
  it('shows the empty-state message for a document whose only block is blank', async () => {
    renderPage('/spaces/space-1/items/doc-1');
    expect(await screen.findByText('This document has no content yet. Ask the agent to fill it in.')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx -t "blank"`
Expected: FAIL — the empty-state text is not found (the page renders blank instead).

- [ ] **Step 3: Add the `isBlockEmpty` helper and use it**

In `web/src/pages/SpacePage.tsx`, add a helper directly above `DocumentDetail` (currently line 679):

```tsx
function isBlockEmpty(block: import('../types.js').Block): boolean {
  return block.type === 'text' && !block.content.trim();
}

function DocumentDetail({ space, item }: { space: Space; item: SpaceItem & { type: 'document' } }) {
```

(If `Block` is already imported by name at the top of the file — check the existing `import type { Connection, Pipeline, Plan, Session, Space, SpaceItem, SpaceItemType } from '../types.js';` on line 60 — add `Block` to that import list instead of using the inline `import(...)` type syntax:

```tsx
import type { Block, Connection, Pipeline, Plan, Session, Space, SpaceItem, SpaceItemType } from '../types.js';
```

and then declare the helper as:

```tsx
function isBlockEmpty(block: Block): boolean {
  return block.type === 'text' && !block.content.trim();
}
```

Use this version — it's cleaner than the inline `import()` type.)

Then update the condition on line 688 from:

```tsx
        {item.blocks.length === 0 ? (
```

to:

```tsx
        {item.blocks.every(isBlockEmpty) ? (
```

Note: `[].every(...)` returns `true` for an empty array, so this single check correctly covers both the original "no blocks at all" case and the new "blocks exist but are all blank" case.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx -t "blank"`
Expected: PASS

- [ ] **Step 5: Run the full SpacePage test file**

Run: `cd web && npx vitest run src/pages/SpacePage.test.tsx`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject
git add web/src/pages/SpacePage.tsx web/src/pages/SpacePage.test.tsx
git commit -m "fix(item-detail): show empty-state message when all document blocks are blank"
```

---

## Task 5: Manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server if not already running**

Run: `cd web && npm run dev` (skip if already running on `localhost:5173`)

- [ ] **Step 2: Walk through both existing spaces**

Using a browser (or Playwright, as used earlier in this conversation):
1. Open a space — confirm the tab strip shows 6 pills (Overview, Chats, Items, Plans, Pipelines, Settings), Overview is active and pill-highlighted, header shows just the space name with no description line.
2. Click "Items" — confirm header still shows the space name (not "Items"), Items pill is now highlighted, no breadcrumb link appears anywhere.
3. Click into an item with content (e.g. "My Test Doc" if it has real blocks) — confirm content still renders (this page is unchanged by this plan; the empty-state fix only affects all-blank documents).
4. If a document item has no real content, confirm it now shows "This document has no content yet. Ask the agent to fill it in." instead of a blank page.

- [ ] **Step 3: Run the full web test suite**

Run: `cd web && npx vitest run`
Expected: All tests PASS, no regressions outside `SpacePage.test.tsx`.

- [ ] **Step 4: Report back to the user**

Summarize what was verified and flag anything that looked off before considering the work done.
