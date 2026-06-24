# Document Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `document` item type composed of typed blocks, expose generic agent tools to create/read/update items, upgrade the repo item with an agent-defined overview section, and render everything in the frontend.

**Architecture:** A new `space_documents` table stores a JSON `blocks` array per item. The existing `space_items` base table gains a `'document'` type. Three generic agent tools (`create_item`, `update_item`, `read_item`) handle all item types. The frontend renders blocks through a single `BlockRenderer` component. The repo item gains an optional `overview_blocks` column rendered above the file browser.

**Tech Stack:** SQLite (better-sqlite3), Express, React, TypeScript, Tailwind CSS, TanStack Query

## Global Constraints

- Block storage is a JSON column for now; the API surface must not expose storage internals so migration to row-based blocks later requires no frontend or agent-tool changes
- `note`, `file`, `repo` existing types are unchanged — no migrations, no renames
- Agent tools are generic (`create_item`, `update_item`, `read_item`) — no type-specific tool variants
- `TaskListBlock` is the only interactive block at launch — checkbox toggles patch the item via `PATCH /spaces/:spaceId/items/:itemId/tasks/:taskId`
- No user-facing block editor — documents are agent-authored, user-viewed
- Block schema is shared (TypeScript types) between server and web client via the existing `types.ts` pattern

---

## Block Schema

Defined in `web/src/types.ts` and imported by the server where needed:

```typescript
export type Block =
  | { type: 'text'; content: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'task-list'; tasks: { id: string; text: string; done: boolean }[] }
  | { type: 'callout'; variant: 'info' | 'warning' | 'success' | 'error'; content: string }
  | { type: 'file-browser' }
```

---

## Templates

Starter block sets used by the agent and server-side tool handler. Defined in `web/src/lib/item-templates.ts` (canonical) and duplicated in `server/src/lib/item-templates.ts` for agent tool use.

| Template | Starter blocks |
|---|---|
| `document` | single empty `text` block |
| `spec` | h1, info callout, h2 "Approach", text, h2 "Success Criteria", task-list, h2 "Open Questions", task-list |
| `kanban` | h1, h2 "To Do" + task-list, h2 "In Progress" + task-list, h2 "Done" + task-list |
| `report` | h1, text (summary), h2 "Details", text |
| `repo` (overview) | info callout — "No overview yet. Ask the agent to describe this repo." |

---

## Data Model

### New table: `space_documents`

```sql
CREATE TABLE space_documents (
  item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
  template TEXT NOT NULL DEFAULT 'document',
  blocks  TEXT NOT NULL DEFAULT '[]'
);
```

### Extend `space_repos`

```sql
ALTER TABLE space_repos ADD COLUMN overview_blocks TEXT;
```

`overview_blocks` is nullable JSON — null means no overview section is shown.

---

## API

### Extended: `POST /spaces/:spaceId/items`

Accepts `type: 'document'` in addition to existing types:

```json
{
  "type": "document",
  "name": "Auth Flow Spec",
  "template": "spec",
  "blocks": []
}
```

If `blocks` is empty/omitted, the template's starter blocks are used.

### Extended: `PATCH /spaces/:spaceId/items/:itemId`

For `document` items — full block replacement:
```json
{ "blocks": [...] }
```

For `repo` items — overview update:
```json
{ "overview_blocks": [...] }
```

Existing name/content patching for `note` items is unchanged.

### Existing: `GET /spaces/:spaceId/items/:itemId`

No change to route. `hydrate()` for `document` type returns `{ ...base, type: 'document', template, blocks: Block[] }`.

### New: `PATCH /spaces/:spaceId/items/:itemId/tasks/:taskId`

Updates a single task's `done` state within a `task-list` block:

```json
{ "done": true }
```

Server finds the task by `id` across all `task-list` blocks and patches in place.

---

## Agent Tools

Three tools added to `server/src/tools/definitions.ts` and implemented in `server/src/tools/item_ops.ts`.

### `create_item`

```
Creates an item in a space. Pass type-specific fields only.

Inputs:
  space_id  string  (required)
  name      string  (required)
  type      'document' | 'repo' | 'note'  (required — 'file' not supported, files are upload-only)

  If type = 'document':
    template  'document' | 'spec' | 'kanban' | 'report'  (default: 'document')
    blocks    Block[]  (optional — omit to use template starter blocks)

  If type = 'repo':
    repo_path       string  (required)
    default_branch  string  (optional)

  If type = 'note':
    content  string  (required — markdown)
```

Returns the created item object including `id`.

### `update_item`

```
Updates an item's content. Pass only the fields that apply to the type.

Inputs:
  space_id  string  (required)
  item_id   string  (required)

  If document: blocks  Block[]
  If repo:     overview_blocks  Block[]
  If note:     content  string
```

### `read_item`

```
Returns the current content of an item.

Inputs:
  space_id  string  (required)
  item_id   string  (required)

Returns the full item object: base fields + type-specific fields (blocks, overview_blocks, content, repo_path, etc.)
```

---

## Chat Inline Card

When the agent calls `create_item` or `update_item`, the server emits an `item_event` on the chat SSE stream:

```json
{
  "type": "item_event",
  "op": "created" | "updated",
  "item": { "id", "name", "type", "template", "space_id" }
}
```

`ChatView` renders a small inline card in the message flow when this event is received:

```
[ Doc ]  Auth Flow Spec  →
```

Clicking navigates to `/spaces/:spaceId/items/:itemId`.

---

## Frontend Components

### `web/src/components/BlockRenderer.tsx`

```tsx
export default function BlockRenderer({ block, spaceId, itemId }: { block: Block; spaceId: string; itemId: string }) {
  switch (block.type) {
    case 'text':     return <TextBlock block={block} />;
    case 'heading':  return <HeadingBlock block={block} />;
    case 'code':     return <CodeBlock block={block} />;
    case 'table':    return <TableBlock block={block} />;
    case 'image':    return <ImageBlock block={block} />;
    case 'task-list': return <TaskListBlock block={block} />;
    case 'callout':  return <CalloutBlock block={block} />;
    case 'file-browser': return <FileBrowserBlock />;
  }
}
```

`TaskListBlock` calls `PATCH /spaces/:spaceId/items/:itemId/tasks/:taskId` on checkbox toggle via TanStack Query mutation.

### `DocumentDetail` in `web/src/pages/SpacePage.tsx`

New branch in `ItemDetail`:

```tsx
{item.type === 'document' && <DocumentDetail space={space} item={item} />}
```

Renders inside `PageBody`:
```tsx
<ContentColumn className="max-w-2xl py-6">
  <div className="flex flex-col gap-4">
    {item.blocks.map((block, i) => (
      <BlockRenderer key={i} block={block} spaceId={space.id} itemId={item.id} />
    ))}
  </div>
</ContentColumn>
```

Template badge displayed in `PageHeader` alongside the item name.

### Repo item upgrade in `RepoDetail`

```tsx
function RepoDetail({ space, item }) {
  return (
    <PageBody className="p-4 sm:p-5">
      {item.overview_blocks?.length > 0 && (
        <div className="mb-6 flex flex-col gap-4">
          {item.overview_blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} spaceId={space.id} itemId={item.id} />
          ))}
        </div>
      )}
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
        {/* existing repo path bar */}
      </div>
      <FileBrowser spaceId={space.id} itemId={item.id} itemName={item.name} />
    </PageBody>
  );
}
```

### `web/src/lib/item-templates.ts`

```typescript
export const ITEM_TEMPLATES: Record<string, Block[]> = {
  document: [{ type: 'text', content: '' }],
  spec: [
    { type: 'heading', level: 1, text: 'Overview' },
    { type: 'callout', variant: 'info', content: 'Describe the problem this solves.' },
    { type: 'heading', level: 2, text: 'Approach' },
    { type: 'text', content: '' },
    { type: 'heading', level: 2, text: 'Success Criteria' },
    { type: 'task-list', tasks: [] },
    { type: 'heading', level: 2, text: 'Open Questions' },
    { type: 'task-list', tasks: [] },
  ],
  kanban: [
    { type: 'heading', level: 1, text: 'Tasks' },
    { type: 'heading', level: 2, text: 'To Do' },
    { type: 'task-list', tasks: [] },
    { type: 'heading', level: 2, text: 'In Progress' },
    { type: 'task-list', tasks: [] },
    { type: 'heading', level: 2, text: 'Done' },
    { type: 'task-list', tasks: [] },
  ],
  report: [
    { type: 'heading', level: 1, text: 'Report' },
    { type: 'text', content: '' },
    { type: 'heading', level: 2, text: 'Details' },
    { type: 'text', content: '' },
  ],
};

export const REPO_OVERVIEW_STARTER: Block[] = [
  { type: 'callout', variant: 'info', content: 'No overview yet. Ask the agent to describe this repo.' },
];
```

---

## Files Touched

| File | Change |
|---|---|
| `server/src/db/migrate.ts` | Add `space_documents` table + `overview_blocks` column migration |
| `server/src/services/items.ts` | Add `document` type to `SpaceItemType`, `createDocumentItem`, `hydrate` branch |
| `server/src/routes/spaces.ts` | Extend `POST /items`, `PATCH /items/:id`, add `PATCH /items/:id/tasks/:taskId` |
| `server/src/tools/definitions.ts` | Add `create_item`, `update_item`, `read_item` tool definitions |
| `server/src/tools/item_ops.ts` | New file — implement the three tool handlers |
| `server/src/lib/item-templates.ts` | New file — template starter blocks (server copy) |
| `web/src/types.ts` | Add `Block` type, extend `SpaceItem` union with `document` variant |
| `web/src/lib/item-templates.ts` | New file — template starter blocks (client copy) |
| `web/src/lib/api.ts` | Add `updateItemBlocks`, `updateRepoOverview`, `updateTask` API calls |
| `web/src/components/BlockRenderer.tsx` | New file — all block sub-renderers |
| `web/src/pages/SpacePage.tsx` | Add `DocumentDetail`, upgrade `RepoDetail`, add `item_event` handling |
| `web/src/components/ChatView.tsx` | Handle `item_event` stream events, render inline item card |
