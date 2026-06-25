# Item Templates

Supersedes the earlier "document items" plan. That plan shipped (commits `2dfcc6f`..`8141474`): a `document` item type with blocks, driven by a hardcoded `ITEM_TEMPLATES` map (`document`/`spec`/`kanban`/`report`). This plan turns that hardcoded map into a real, persisted, agent/user-editable **template** system.

## Model

- **Templates are the unit of creation.** Every item — including `repo`, `file`, `note` — is created "from a template." `repo`/`file`/`note` are **system templates**: fixed behavior, no blocks, listed for discoverability/UI symmetry but not editable.
- **`document`/`spec`/`kanban`/`report` become builtin *block* templates** — same starter content as before, but rows in a real table instead of a code constant.
- **The agent (or user) can create new block templates** (`create_item_template`) and **edit any block template's blocks later** (`update_item_template`) — including the builtins. Editing a template only changes its starter content for *future* items; existing items already cloned from it are unaffected (no live sync, no migration).
- **`create_item` for a block-backed item always requires a `template_id`.** There is no more "pass arbitrary `blocks` at creation time" — creation always clones the named template's current blocks. Free-form block editing still happens after creation via `update_item`/`update_item.blocks`, same as today.

## Data model

New table `item_templates`:

```sql
CREATE TABLE item_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,  -- NULL = global builtin
  kind TEXT NOT NULL CHECK(kind IN ('system', 'blocks')),
  name TEXT NOT NULL,
  blocks TEXT,            -- JSON Block[] (kind='blocks' only, NULL for 'system')
  item_type TEXT NOT NULL CHECK(item_type IN ('repo', 'file', 'note', 'document')),
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

Seed rows (migration, `user_id = NULL`, global):
- `tpl_repo` (system, item_type=repo), `tpl_file` (system, item_type=file), `tpl_note` (system, item_type=note)
- `tpl_document` / `tpl_spec` / `tpl_kanban` / `tpl_report` (blocks, item_type=document) — blocks copied verbatim from current `ITEM_TEMPLATES`.

`space_documents.template` (existing column) now stores an `item_templates.id` instead of a free string key (`'document'` → `'tpl_document'`, etc.) — same column, no schema change there. Add a one-time data migration remapping any existing rows' legacy string values to the new builtin ids.

## File-by-file changes

| File | Change |
|---|---|
| `server/src/db/index.ts` | New migration: create `item_templates`, seed builtin rows, remap existing `space_documents.template` values from legacy strings to `tpl_*` ids |
| `server/src/services/templates.ts` | **New.** `listItemTemplates(userId)`, `getItemTemplate(id)`, `createItemTemplate(userId, name, blocks)`, `updateItemTemplate(id, blocks, name?)` |
| `server/src/services/items.ts` | `createDocumentItem` takes `template_id` (looks up + clones blocks via `templates.ts`) instead of `template: string; blocks: Block[]` |
| `server/src/lib/item-templates.ts` (web + server copies) | Delete — replaced by `item_templates` table content seeded in migration |
| `server/src/routes/spaces.ts` | `POST /items` (document branch) takes `template_id`, 404s if unknown; new `GET /item-templates`, `POST /item-templates`, `PATCH /item-templates/:id` routes |
| `server/src/tools/item_ops.ts` | `runCreateItem` drops `blocks` param for type=document, requires `template_id`; add `runCreateItemTemplate`, `runUpdateItemTemplate`, `runListItemTemplates` |
| `server/src/tools/definitions.ts` | `create_item` schema: replace `template` enum + `blocks` with free `template_id` string; add `create_item_template`, `update_item_template`, `list_item_templates` tool defs |
| `server/src/services/agent.ts` | Wire the 3 new tool cases into the dispatch switch |
| `web/src/types.ts` | `SpaceItem` document variant: `template` → `template_id`; add `ItemTemplate` type |
| `web/src/lib/api.ts` | `listItemTemplates()`, `createItemTemplate()`, `updateItemTemplate()`; `createSpaceItem` sends `template_id` not `template`/`blocks` |
| `web/src/pages/SpacePage.tsx` | New-item dialog: replace hardcoded `DOCUMENT_TEMPLATES` array + label map with a live query against `listItemTemplates()` |
| `web/src/components/MessageList.tsx` | Inline item-created card: drop static `TEMPLATE_LABELS` lookup, show the template's actual name from the created item |

## Block catalog (v1)

Blocks are a small component library the agent assembles a screen from, not document-formatting primitives. v1 set: `text`, `heading`, `code`, `table`, `image`, `list` (plain bullet/numbered), `task-list` (checkable, self-contained interactivity via `PATCH .../tasks/:taskId`), `callout`, `chart` (line/bar/pie via recharts), `stat` (metric tile + optional trend), `progress` (bar), `file-browser` (repo overview only). The full catalog is documented inline in `BLOCK_CATALOG` in `server/src/tools/definitions.ts` and surfaced in the `create_item_template`/`update_item` tool descriptions so the agent knows what's available without guessing.

Deliberately deferred: blocks that trigger arbitrary backend actions (vs. self-contained interactivity like checkbox toggles) — that's a separate, bigger primitive (a generic "block click calls back into the agent" mechanism) worth designing on its own later.

## Out of scope (deliberately deferred)

- No live structural sync between a template and items already created from it.
- No dedicated "manage templates" UI screen — template creation/editing is agent-tool-driven for now; the new-item dialog only *reads* the list.
- `repo`/`file`/`note` keep their existing dedicated creation params (`repo_path`, `file_path`, `content`) — the template row for them is metadata only, not a generator.
