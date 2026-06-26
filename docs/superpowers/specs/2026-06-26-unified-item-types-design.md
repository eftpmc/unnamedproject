# Unified Item Type System

**Date:** 2026-06-26
**Status:** Approved

## Problem

Item types are split across two disconnected systems:

- **Structured types** (`repo`, `file`): hardcoded DB tables (`space_repos`, `space_files`), hardcoded service functions, hardcoded hydration logic. The agent cannot touch these.
- **Template types** (`blank`, `spec`, `kanban`, …): agent-authored via `create_item_template`. Frontend-only — blocks define the UI, nothing more.

The agent can customize the frontend of any item, but has no access to the backend. Creating a new structured type requires developer code. This is the gap to close.

## Goal

Every item type is a single agent-authored definition with two halves:

```
item type definition
├── backend template
│   ├── schema       — typed field declarations
│   └── capabilities — platform behavior primitives
└── frontend template
    └── blocks       — default UI layout
```

The agent calls `define_item_type` once and gets both. `repo` and `file` become builtin examples of this pattern, not special cases.

## Mental Model: Capability Primitives

Capabilities are named contracts between a type definition and the server's behavior library. The agent declares which capabilities a type has; the server runs the corresponding behavior at the right lifecycle point. The agent picks *what hooks fire*, not *what they do*.

### Approved Capability List (v1)

| Capability | Hook | Server behavior |
|---|---|---|
| `file-readable` | `read_item` | Reads file at `fields.file_path`, appends content to response |
| `git-aware` | tool eligibility | Git tools use `fields.repo_path` as working directory; reject calls on items without this capability |
| `web-fetchable` | `create_item` + on-demand | Enqueues background fetch of `fields.url`; enables `fetch_item_url` tool |
| `embeddable` | `create_item` + `update_item` | Queues embedding job on content change; enables semantic search |
| `schedulable` | `create_item` + `update_item` | Registers/updates recurring job from `fields.cron`; fires on schedule |

New capabilities require a developer to wire the server behavior. That is the guardrail.

### Capability/Schema Contract

Each capability requires specific fields in the schema:

| Capability | Required field |
|---|---|
| `file-readable` | `file_path: { type: "string", required: true }` |
| `git-aware` | `repo_path: { type: "string", required: true }` |
| `web-fetchable` | `url: { type: "string", required: true }` |
| `schedulable` | `cron: { type: "string", required: true }` |

`define_item_type` validates this contract at definition time, not at item creation.

## Storage

### What is deleted
- `space_repos` table — dropped
- `space_files` table — dropped
- Fresh DB (no migration of existing data)

### What changes

**`space_items`** gains one column:
```sql
fields TEXT NOT NULL DEFAULT '{}'
```
JSON blob of field values, validated against the type's schema on every write.

**`item_templates`** gains two columns:
```sql
schema       TEXT NOT NULL DEFAULT '{}'
capabilities TEXT NOT NULL DEFAULT '[]'
```
This table becomes the unified type registry for all item types — builtin and agent-defined.

### Builtin types (seeded at startup)

| id | name | schema fields | capabilities |
|---|---|---|---|
| `repo` | Repository | `repo_path` (req), `default_branch` | `git-aware, file-readable` |
| `file` | File | `file_path` (req), `size_bytes`, `mime_type` | `file-readable` |
| `blank` | Blank | — | — |
| `spec` | Spec | — | — |
| `kanban` | Kanban | — | — |
| `report` | Report | — | — |
| `runbook` | Runbook | — | — |
| `config` | Config | — | — |

## MCP Tools

### New: `define_item_type`
```
define_item_type(
  name: string,
  schema: {
    [field]: {
      type: "string" | "number" | "boolean" | "enum",
      required?: boolean,
      options?: string[]   // enum only
    }
  },
  capabilities: string[],
  blocks: Block[]
)
```
Returns the created type definition. Rejects names that collide with builtins.

### Updated: `create_item`
Gains `fields?: Record<string, any>`. Server validates against type schema before writing. Missing required fields → error with field name.

### Updated: `update_item`
Gains `fields?: Record<string, any>`. Patch semantics — merged into existing fields, not replaced wholesale.

### Renamed: `list_item_types`
Replaces `list_item_templates`. Returns full definition per type: schema, capabilities, blocks.

### Retired
- `create_item_template` — absorbed into `define_item_type`
- `update_item_template` — to update a custom type's blocks or schema, call `define_item_type` again with the same name (upsert semantics; builtins still protected)

## Guardrails

**Schema validation on write:** `create_item` and `update_item` validate `fields` against the type schema. Required fields missing → error. Wrong type → error. Unknown fields → silently ignored (not stored).

**Capability allowlist:** `define_item_type` rejects capabilities not in the approved list with a descriptive error listing what is available.

**Builtin protection:** Types with `is_builtin = true` cannot be redefined via `define_item_type`. Agent can read and create items from them, not overwrite them.

**Contract enforcement:** Capability/schema contract (e.g. `file-readable` requires `file_path`) is validated at `define_item_type` time with a clear error message.

## TypeScript

`RepoItem` and `FileItem` types are removed. `SpaceItem` collapses to `SpaceItemBase & { fields: Record<string, any> }`. The type union disappears — there is one item shape.

`hydrate()` no longer has branches for `repo` and `file`. It reads `fields` JSON from the row and returns it. Capability-dependent behavior is triggered by the tool layer, not the hydration layer.

## Service Architecture

```
MCP tool (create_item)
  → validate fields against type schema          [new]
  → insert space_items row (with fields JSON)    [changed]
  → trigger capability hooks                     [new]
      file-readable: no-op on create
      git-aware: no-op on create
      embeddable: queue embedding job
      schedulable: register cron job
      web-fetchable: enqueue URL fetch
```

Capability hooks live in a `capabilities/` module, one file per capability. Each exports `onCreate`, `onUpdate`, `onRead` handlers (all optional). The tool layer calls them after the DB write succeeds.
