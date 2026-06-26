# Unified Item Type System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split structured/template item type system with a single agent-authored type definition that declares both a backend schema (typed fields) and capability primitives, plus a default frontend block layout.

**Architecture:** Every item type lives in `item_templates` with added `schema` (typed field definitions) and `capabilities` (platform behavior hooks) columns. Items store field values as a JSON blob in `space_items.fields`. Capability hooks fire at lifecycle points (`read_item`, `create_item`, `update_item`). The `RepoItem`/`FileItem` union collapses — there is one `SpaceItem` shape with `fields: Record<string, any>`.

**Tech Stack:** TypeScript, better-sqlite3, vitest, existing `embeddings.ts` service

## Global Constraints

- Fresh DB — no data migration needed, only schema changes via new migration v23
- `space_repos` and `space_files` tables are dropped
- `RepoItem` and `FileItem` TypeScript types are removed; `SpaceItem = SpaceItemBase`
- Capabilities approved list (v1): `git-aware`, `file-readable`, `web-fetchable`, `embeddable`, `schedulable`
- Field schema types: `"string"`, `"number"`, `"boolean"`, `"enum"`
- `define_item_type` upserts by name — same name updates an existing custom type; builtin types (`is_builtin = true`) are protected
- `update_item` `fields` param uses patch semantics (merged, not replaced)
- Run tests with: `npm run test --prefix server`

---

## File Map

**Modified:**
- `server/src/db/index.ts` — add migration v23
- `server/src/services/items.ts` — collapse type union, add fields support
- `server/src/services/templates.ts` — add schema/capabilities, add upsertItemType
- `server/src/tools/item_ops.ts` — wire new tools, update existing ones
- `server/src/mcp/handlers/items.ts` — replace/update MCP tool registrations
- `server/src/lib/worktree.ts` — accept `SpaceItem`, read `fields.repo_path`
- `server/src/tools/project_query.ts` — read `fields.repo_path`
- `server/src/tools/project_ops.ts` — filter by capability, use unified createItem
- `server/src/tools/file_ops.ts` — read `fields.repo_path`
- `server/src/tools/run_command.ts` — read `fields.repo_path`
- `server/src/mcp/handlers/git.ts` — check `git-aware` capability
- `server/src/mcp/handlers/knowledge.ts` — read `fields.repo_path`
- `server/src/routes/spaces.ts` — update item creation routes, requireRepoItem
- `server/src/routes/sessions.ts` — fix SQL queries that joined `space_repos`
- `server/src/services/agent.ts` — filter by capability
- `server/src/services/context.ts` — filter by capability
- `server/src/services/items.test.ts` — update setup schema, update tests

**Created:**
- `server/src/lib/item-schema.ts` — field schema definition + validation
- `server/src/lib/item-schema.test.ts` — schema validation tests
- `server/src/services/capabilities.ts` — capability registry + lifecycle hooks
- `server/src/services/capabilities.test.ts` — capability tests

---

### Task 1: item-schema lib

**Files:**
- Create: `server/src/lib/item-schema.ts`
- Create: `server/src/lib/item-schema.test.ts`

**Interfaces:**
- Produces:
  - `FieldDef: { type: "string"|"number"|"boolean"|"enum"; required?: boolean; options?: string[] }`
  - `ItemSchema: Record<string, FieldDef>`
  - `validateSchema(schema: unknown): string | null` — returns error string or null
  - `validateFields(fields: unknown, schema: ItemSchema): string | null`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/lib/item-schema.test.ts
import { describe, it, expect } from 'vitest';
import { validateSchema, validateFields } from './item-schema.js';

describe('validateSchema', () => {
  it('accepts valid schema', () => {
    expect(validateSchema({
      repo_path: { type: 'string', required: true },
      count: { type: 'number' },
      active: { type: 'boolean' },
      status: { type: 'enum', options: ['open', 'closed'] },
    })).toBeNull();
  });

  it('rejects non-object', () => {
    expect(validateSchema('bad')).toMatch(/object/);
  });

  it('rejects unknown field type', () => {
    expect(validateSchema({ x: { type: 'date' } })).toMatch(/type/);
  });

  it('rejects enum without options', () => {
    expect(validateSchema({ x: { type: 'enum' } })).toMatch(/options/);
  });
});

describe('validateFields', () => {
  const schema = {
    name: { type: 'string' as const, required: true },
    count: { type: 'number' as const },
    status: { type: 'enum' as const, options: ['a', 'b'] },
  };

  it('passes when required fields present', () => {
    expect(validateFields({ name: 'hi' }, schema)).toBeNull();
  });

  it('fails when required field missing', () => {
    expect(validateFields({}, schema)).toMatch(/name/);
  });

  it('fails when field has wrong type', () => {
    expect(validateFields({ name: 42 }, schema)).toMatch(/name/);
  });

  it('fails when enum value not in options', () => {
    expect(validateFields({ name: 'x', status: 'c' }, schema)).toMatch(/status/);
  });

  it('ignores unknown fields silently', () => {
    expect(validateFields({ name: 'x', unknown: true }, schema)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|item-schema"
```

Expected: FAIL — `item-schema.js` not found

- [ ] **Step 3: Implement item-schema.ts**

```typescript
// server/src/lib/item-schema.ts
export type FieldType = 'string' | 'number' | 'boolean' | 'enum';

export interface FieldDef {
  type: FieldType;
  required?: boolean;
  options?: string[];
}

export type ItemSchema = Record<string, FieldDef>;

const FIELD_TYPES = new Set<string>(['string', 'number', 'boolean', 'enum']);

export function validateSchema(schema: unknown): string | null {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return 'schema must be an object';
  }
  for (const [key, def] of Object.entries(schema as Record<string, unknown>)) {
    if (typeof def !== 'object' || def === null) return `schema.${key} must be an object`;
    const d = def as Record<string, unknown>;
    if (!FIELD_TYPES.has(d.type as string)) {
      return `schema.${key}.type must be one of: string, number, boolean, enum`;
    }
    if (d.type === 'enum') {
      if (!Array.isArray(d.options) || d.options.length === 0) {
        return `schema.${key}.options must be a non-empty array for enum fields`;
      }
    }
  }
  return null;
}

export function validateFields(fields: unknown, schema: ItemSchema): string | null {
  if (typeof fields !== 'object' || fields === null) return 'fields must be an object';
  const f = fields as Record<string, unknown>;
  for (const [key, def] of Object.entries(schema)) {
    const value = f[key];
    if (def.required && (value === undefined || value === null)) {
      return `fields.${key} is required`;
    }
    if (value === undefined || value === null) continue;
    switch (def.type) {
      case 'string':
        if (typeof value !== 'string') return `fields.${key} must be a string`;
        break;
      case 'number':
        if (typeof value !== 'number') return `fields.${key} must be a number`;
        break;
      case 'boolean':
        if (typeof value !== 'boolean') return `fields.${key} must be a boolean`;
        break;
      case 'enum':
        if (!def.options!.includes(value as string)) {
          return `fields.${key} must be one of: ${def.options!.join(', ')}`;
        }
        break;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "item-schema|✓|✗|PASS|FAIL"
```

Expected: All item-schema tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/item-schema.ts server/src/lib/item-schema.test.ts
git commit -m "feat: item field schema definition and validation"
```

---

### Task 2: capabilities module

**Files:**
- Create: `server/src/services/capabilities.ts`
- Create: `server/src/services/capabilities.test.ts`

**Interfaces:**
- Consumes: `SpaceItemBase & { fields: Record<string, any> }` (from Task 4), `embed()` from `embeddings.ts`
- Produces:
  - `ALLOWED_CAPABILITIES: readonly string[]`
  - `CAPABILITY_REQUIRED_FIELDS: Record<string, string>` — capability → required field name
  - `validateCapabilities(caps: unknown): string | null`
  - `validateCapabilityFieldContracts(schema: ItemSchema, caps: string[]): string | null`
  - `onRead(item: SpaceItemBase, caps: string[]): Promise<Record<string, unknown>>` — returns extra data to merge into read response
  - `onCreate(item: SpaceItemBase, caps: string[]): Promise<void>`
  - `onUpdate(item: SpaceItemBase, caps: string[]): Promise<void>`

**Note:** `onRead` for `file-readable` needs `fs` from node — import at top. `embeddable` uses `embed()` from `../services/embeddings.js`. Since this module is in `services/`, the import path is `./embeddings.js`. For the test, mock both.

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/services/capabilities.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  ALLOWED_CAPABILITIES,
  CAPABILITY_REQUIRED_FIELDS,
  validateCapabilities,
  validateCapabilityFieldContracts,
} from './capabilities.js';

describe('validateCapabilities', () => {
  it('accepts empty array', () => {
    expect(validateCapabilities([])).toBeNull();
  });

  it('accepts all known capabilities', () => {
    expect(validateCapabilities(['git-aware', 'file-readable'])).toBeNull();
  });

  it('rejects unknown capability', () => {
    expect(validateCapabilities(['file-readable', 'auto-syncing'])).toMatch(/auto-syncing/);
  });

  it('rejects non-array', () => {
    expect(validateCapabilities('file-readable')).toMatch(/array/);
  });
});

describe('validateCapabilityFieldContracts', () => {
  it('passes when file-readable has file_path', () => {
    const schema = { file_path: { type: 'string' as const, required: true } };
    expect(validateCapabilityFieldContracts(schema, ['file-readable'])).toBeNull();
  });

  it('fails when file-readable missing file_path', () => {
    expect(validateCapabilityFieldContracts({}, ['file-readable'])).toMatch(/file_path/);
  });

  it('fails when git-aware missing repo_path', () => {
    expect(validateCapabilityFieldContracts({}, ['git-aware'])).toMatch(/repo_path/);
  });

  it('passes when schedulable has cron', () => {
    const schema = { cron: { type: 'string' as const, required: true } };
    expect(validateCapabilityFieldContracts(schema, ['schedulable'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "capabilities|FAIL|PASS"
```

Expected: FAIL — `capabilities.js` not found

- [ ] **Step 3: Implement capabilities.ts**

```typescript
// server/src/services/capabilities.ts
import fs from 'fs/promises';
import type { ItemSchema } from '../lib/item-schema.js';

export const ALLOWED_CAPABILITIES = [
  'git-aware',
  'file-readable',
  'web-fetchable',
  'embeddable',
  'schedulable',
] as const;

export type Capability = typeof ALLOWED_CAPABILITIES[number];

// Each capability that requires a specific field to exist in the schema
export const CAPABILITY_REQUIRED_FIELDS: Partial<Record<Capability, string>> = {
  'git-aware': 'repo_path',
  'file-readable': 'file_path',
  'web-fetchable': 'url',
  'schedulable': 'cron',
};

export function validateCapabilities(caps: unknown): string | null {
  if (!Array.isArray(caps)) return 'capabilities must be an array';
  for (const cap of caps) {
    if (!(ALLOWED_CAPABILITIES as readonly string[]).includes(cap)) {
      return `unknown capability '${cap}' — available: ${ALLOWED_CAPABILITIES.join(', ')}`;
    }
  }
  return null;
}

export function validateCapabilityFieldContracts(schema: ItemSchema, caps: string[]): string | null {
  for (const cap of caps) {
    const required = CAPABILITY_REQUIRED_FIELDS[cap as Capability];
    if (required && !schema[required]) {
      return `capability '${cap}' requires field '${required}' in schema`;
    }
  }
  return null;
}

export interface SpaceItemForCapability {
  id: string;
  type: string;
  page_blocks: unknown[];
  fields: Record<string, unknown>;
}

export async function onRead(
  item: SpaceItemForCapability,
  caps: string[],
): Promise<Record<string, unknown>> {
  const extra: Record<string, unknown> = {};
  if (caps.includes('file-readable') && typeof item.fields.file_path === 'string') {
    try {
      const content = await fs.readFile(item.fields.file_path);
      extra.content = content.toString();
    } catch {
      extra.content = null;
      extra.content_error = 'file not readable';
    }
  }
  return extra;
}

export async function onCreate(item: SpaceItemForCapability, caps: string[]): Promise<void> {
  await triggerEmbedding(item, caps);
}

export async function onUpdate(item: SpaceItemForCapability, caps: string[]): Promise<void> {
  await triggerEmbedding(item, caps);
}

async function triggerEmbedding(item: SpaceItemForCapability, caps: string[]): Promise<void> {
  if (!caps.includes('embeddable')) return;
  // Fire-and-forget — don't block the write response on embedding
  const { embed } = await import('./embeddings.js');
  const text = buildEmbeddableText(item);
  if (!text) return;
  embed(text).catch((err: unknown) => {
    console.error(`[embeddable] Failed to embed item ${item.id}:`, err);
  });
}

function buildEmbeddableText(item: SpaceItemForCapability): string {
  const parts: string[] = [];
  for (const block of item.page_blocks as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.content === 'string') parts.push(block.content);
    if (block.type === 'heading' && typeof block.text === 'string') parts.push(block.text);
  }
  for (const value of Object.values(item.fields)) {
    if (typeof value === 'string') parts.push(value);
  }
  return parts.join('\n').trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "capabilities|✓|✗|PASS|FAIL"
```

Expected: All capability tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/services/capabilities.ts server/src/services/capabilities.test.ts
git commit -m "feat: capabilities module with validation and lifecycle hooks"
```

---

### Task 3: DB migration v23

**Files:**
- Modify: `server/src/db/index.ts`

**What this migration does:**
1. Adds `fields TEXT NOT NULL DEFAULT '{}'` to `space_items`
2. Adds `schema TEXT NOT NULL DEFAULT '{}'` to `item_templates`
3. Adds `capabilities TEXT NOT NULL DEFAULT '[]'` to `item_templates`
4. Drops `space_repos` and `space_files`
5. Updates builtin type definitions for `repo` and `file` with schema + capabilities

**Note on fresh DB:** On a fresh DB all migrations run in order. Migration v22 creates `space_repos` — so v23 can safely drop it. Migration v11 creates `item_templates` — so v23 can safely `ALTER TABLE` it.

- [ ] **Step 1: Add migration v23 to the migrations array in `server/src/db/index.ts`**

Find the end of the migrations array (after the `{ version: 22, ... }` entry, before the closing `]`). Add:

```typescript
  { version: 23, name: 'unified-item-types', up: (db) => {
    // 1. Add fields column to space_items
    const itemCols = (db.prepare("PRAGMA table_info(space_items)").all() as { name: string }[]).map(c => c.name);
    if (!itemCols.includes('fields')) {
      db.exec("ALTER TABLE space_items ADD COLUMN fields TEXT NOT NULL DEFAULT '{}'");
    }

    // 2. Add schema + capabilities columns to item_templates
    const tplCols = (db.prepare("PRAGMA table_info(item_templates)").all() as { name: string }[]).map(c => c.name);
    if (!tplCols.includes('schema')) {
      db.exec("ALTER TABLE item_templates ADD COLUMN schema TEXT NOT NULL DEFAULT '{}'");
    }
    if (!tplCols.includes('capabilities')) {
      db.exec("ALTER TABLE item_templates ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'");
    }

    // 3. Drop space_repos and space_files (fresh DB only — data already gone)
    db.pragma('foreign_keys = OFF');
    db.exec('DROP TABLE IF EXISTS space_repos');
    db.exec('DROP TABLE IF EXISTS space_files');
    db.pragma('foreign_keys = ON');

    // 4. Update builtin type definitions with schema + capabilities
    const repoSchema = JSON.stringify({
      repo_path: { type: 'string', required: true },
      default_branch: { type: 'string', required: false },
    });
    const fileSchema = JSON.stringify({
      file_path: { type: 'string', required: true },
      size_bytes: { type: 'number', required: false },
      mime_type: { type: 'string', required: false },
    });
    db.prepare("UPDATE item_templates SET schema = ?, capabilities = ? WHERE id = 'repo'")
      .run(repoSchema, JSON.stringify(['git-aware', 'file-readable']));
    db.prepare("UPDATE item_templates SET schema = ?, capabilities = ? WHERE id = 'file'")
      .run(fileSchema, JSON.stringify(['file-readable']));
  }},
```

- [ ] **Step 2: Verify migration runs cleanly on fresh DB**

```bash
# Kill server if running
lsof -ti :3000 | xargs kill -9 2>/dev/null; true
# Nuke and restart
rm -rf /Users/zack/Documents/GitHub/unnamedproject/server/data
mkdir /Users/zack/Documents/GitHub/unnamedproject/server/data
cd /Users/zack/Documents/GitHub/unnamedproject && npm run dev --prefix server > /tmp/server.log 2>&1 &
sleep 5 && grep -E "migration|Error|running" /tmp/server.log | head -10
```

Expected: `Applied DB migration 23: unified-item-types` and `Server running on port 3000`

- [ ] **Step 3: Verify schema in DB**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject/server/data && sqlite3 app.db ".schema space_items" && sqlite3 app.db ".schema item_templates"
```

Expected: `space_items` has `fields` column; `item_templates` has `schema` and `capabilities` columns; no `space_repos` or `space_files` tables.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/index.ts
git commit -m "feat: migration v23 — unified item types schema"
```

---

### Task 4: Rewrite items.ts

**Files:**
- Modify: `server/src/services/items.ts`
- Modify: `server/src/services/items.test.ts`

**Interfaces:**
- Consumes: `ItemSchema`, `validateFields` from `../lib/item-schema.js`
- Produces:
  - `SpaceItemBase & { fields: Record<string, any> }` (replaces `RepoItem | FileItem | SpaceItemBase`)
  - `SpaceItem = SpaceItemBase` (no union)
  - `createItem(input: CreateItemInput & { type: string; fields?: Record<string, any>; page_blocks?: Block[] }): SpaceItemBase`
  - All existing block-manipulation functions unchanged

**Removed exports:** `RepoItem`, `FileItem`, `isRepoItem`, `isFileItem`, `createRepoItem`, `createFileItem`, `registerFileItem`, `resolveFileItemPath`, `readItemContent`, `createTemplateItem` (replaced by `createItem`)

- [ ] **Step 1: Rewrite items.test.ts setup**

Replace the entire `setupTestDb` function and update tests:

```typescript
// server/src/services/items.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getDataDir: () => '/tmp/test-data',
}));

vi.mock('../lib/ids.js', () => ({
  newId: () => `id_${Math.random().toString(36).slice(2)}`,
}));

function setupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, enabled_connection_ids TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE space_items (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      source_session_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      page_blocks TEXT NOT NULL DEFAULT '[]',
      fields TEXT NOT NULL DEFAULT '{}'
    );
    INSERT INTO spaces VALUES ('space1', 'user1', 'Test Space', NULL, '[]');
  `);
  return db;
}

describe('items service', () => {
  beforeEach(async () => {
    vi.resetModules();
    testDb = setupTestDb();
  });

  it('createItem stores page_blocks and fields', async () => {
    const { createItem } = await import('./items.js');
    const blocks = [{ type: 'text' as const, content: 'hello' }];
    const item = createItem({
      space_id: 'space1',
      name: 'My Spec',
      type: 'spec',
      page_blocks: blocks,
      fields: {},
    });
    expect(item.type).toBe('spec');
    expect(item.page_blocks).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'hello' })]));
    expect(item.fields).toEqual({});
    expect(item.id).toBeTruthy();
  });

  it('createItem stores typed fields', async () => {
    const { createItem } = await import('./items.js');
    const item = createItem({
      space_id: 'space1',
      name: 'My Repo',
      type: 'repo',
      page_blocks: [],
      fields: { repo_path: '/some/path', default_branch: 'main' },
    });
    expect(item.fields.repo_path).toBe('/some/path');
    expect(item.fields.default_branch).toBe('main');
  });

  it('updateItemPageBlocks replaces page_blocks', async () => {
    const { createItem, updateItemPageBlocks, getItemById } = await import('./items.js');
    const item = createItem({ space_id: 'space1', name: 'Doc', type: 'blank', page_blocks: [], fields: {} });
    const newBlocks = [{ type: 'heading' as const, level: 1 as const, text: 'Title' }];
    updateItemPageBlocks(item.id, newBlocks);
    const updated = getItemById(item.id);
    expect(updated?.page_blocks).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Title' })]));
  });

  it('updateItemFields patches fields', async () => {
    const { createItem, updateItemFields, getItemById } = await import('./items.js');
    const item = createItem({
      space_id: 'space1',
      name: 'Repo',
      type: 'repo',
      page_blocks: [],
      fields: { repo_path: '/old', default_branch: 'main' },
    });
    updateItemFields(item.id, { repo_path: '/new' });
    const updated = getItemById(item.id);
    expect(updated?.fields.repo_path).toBe('/new');
    expect(updated?.fields.default_branch).toBe('main'); // patch, not replace
  });
});
```

- [ ] **Step 2: Run tests to see what fails**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "items|FAIL|PASS|✓|✗" | head -30
```

Expected: Tests referencing old API (`createTemplateItem`, `createRepoItem`) fail; others may pass or error.

- [ ] **Step 3: Rewrite items.ts**

```typescript
// server/src/services/items.ts
import fs from 'fs/promises';
import path from 'path';
import { getDataDir, getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export type BlockContent =
  | { type: 'text'; content: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'task-list'; tasks: { id: string; text: string; done: boolean }[] }
  | { type: 'callout'; variant: 'info' | 'warning' | 'success' | 'error'; content: string }
  | { type: 'file-browser' }
  | { type: 'chart'; chartType: 'line' | 'bar' | 'pie'; title?: string; data: { label: string; value: number }[] }
  | { type: 'stat'; label: string; value: string; trend?: { direction: 'up' | 'down' | 'flat'; label?: string } }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'progress'; label?: string; value: number; max?: number }
  | { type: 'input'; label: string; value: string; placeholder?: string; input_type?: 'text' | 'number' | 'multiline' | 'select'; options?: string[] };

export type Block = BlockContent & { id?: string };

interface SpaceItemRow {
  id: string;
  space_id: string;
  type: string;
  name: string;
  source_session_id: string | null;
  created_at: number;
  page_blocks: string;
  fields: string;
}

export interface SpaceItemBase {
  id: string;
  space_id: string;
  type: string;
  name: string;
  source_session_id: string | null;
  created_at: number;
  page_blocks: Block[];
  fields: Record<string, unknown>;
}

export type SpaceItem = SpaceItemBase;

export interface CreateItemInput {
  space_id: string;
  name: string;
  type: string;
  page_blocks?: Block[];
  fields?: Record<string, unknown>;
  source_session_id?: string | null;
}

function ensureBlockIds(blocks: Block[]): Block[] {
  return blocks.map(b => b.id ? b : { ...b, id: newId() });
}

export function createItem(input: CreateItemInput): SpaceItemBase {
  const blocks = ensureBlockIds(input.page_blocks ?? []);
  const fields = input.fields ?? {};
  const row = {
    id: newId(),
    space_id: input.space_id,
    type: input.type,
    name: input.name,
    source_session_id: input.source_session_id ?? null,
    created_at: Math.floor(Date.now() / 1000),
    page_blocks: JSON.stringify(blocks),
    fields: JSON.stringify(fields),
  };
  getDb().prepare(`
    INSERT INTO space_items (id, space_id, type, name, source_session_id, created_at, page_blocks, fields)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.space_id, row.type, row.name, row.source_session_id, row.created_at, row.page_blocks, row.fields);
  return { ...row, page_blocks: blocks, fields };
}

function hydrate(row: SpaceItemRow): SpaceItemBase {
  return {
    ...row,
    page_blocks: row.page_blocks ? JSON.parse(row.page_blocks) as Block[] : [],
    fields: row.fields ? JSON.parse(row.fields) as Record<string, unknown> : {},
  };
}

export function getItemsForSpace(spaceId: string): SpaceItemBase[] {
  const rows = getDb().prepare(
    'SELECT * FROM space_items WHERE space_id = ? ORDER BY created_at DESC, id DESC',
  ).all(spaceId) as SpaceItemRow[];
  return rows.map(hydrate);
}

export function getItemById(itemId: string): SpaceItemBase | undefined {
  const row = getDb().prepare('SELECT * FROM space_items WHERE id = ?').get(itemId) as SpaceItemRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function deleteItem(itemId: string): void {
  getDb().prepare('DELETE FROM space_items WHERE id = ?').run(itemId);
}

export function updateItemPageBlocks(itemId: string, blocks: Block[]): void {
  getDb().prepare('UPDATE space_items SET page_blocks = ? WHERE id = ?').run(JSON.stringify(ensureBlockIds(blocks)), itemId);
}

export function appendItemPageBlocks(itemId: string, blocks: Block[]): boolean {
  const item = getItemById(itemId);
  if (!item) return false;
  updateItemPageBlocks(itemId, [...item.page_blocks, ...blocks]);
  return true;
}

export function updateItemPageBlock(itemId: string, blockId: string, block: Block): boolean {
  const item = getItemById(itemId);
  if (!item) return false;
  const index = item.page_blocks.findIndex(b => b.id === blockId);
  if (index === -1) return false;
  const updated = [...item.page_blocks];
  updated[index] = { ...block, id: blockId };
  updateItemPageBlocks(itemId, updated);
  return true;
}

export function updateItemFields(itemId: string, fields: Record<string, unknown>): boolean {
  const item = getItemById(itemId);
  if (!item) return false;
  const merged = { ...item.fields, ...fields };
  getDb().prepare('UPDATE space_items SET fields = ? WHERE id = ?').run(JSON.stringify(merged), itemId);
  return true;
}

export function updateTaskDone(itemId: string, taskId: string, done: boolean): boolean {
  const item = getItemById(itemId);
  if (!item) return false;
  let found = false;
  const updated = item.page_blocks.map(block => {
    if (block.type !== 'task-list') return block;
    const tasks = block.tasks.map(task => {
      if (task.id !== taskId) return task;
      found = true;
      return { ...task, done };
    });
    return { ...block, tasks };
  });
  if (!found) return false;
  updateItemPageBlocks(itemId, updated);
  return true;
}

export function mimeForPath(filePath: string): string {
  const MIME_BY_EXT: Record<string, string> = {
    '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  };
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export async function registerFileItem(input: CreateItemInput & {
  source_path: string;
  mime_type?: string;
}): Promise<SpaceItemBase> {
  const fileName = path.basename(input.source_path);
  const destinationDir = path.join(getDataDir(), 'spaces', input.space_id, 'files');
  await fs.mkdir(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, `${Date.now()}-${fileName}`);
  await fs.copyFile(input.source_path, destination);
  const stat = await fs.stat(destination);
  return createItem({
    ...input,
    type: 'file',
    fields: {
      file_path: destination,
      size_bytes: stat.size,
      mime_type: input.mime_type ?? mimeForPath(fileName),
    },
  });
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "items|✓|✗|PASS|FAIL" | head -30
```

Expected: All items tests PASS. Some other test files may now fail due to removed exports — those are fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/items.ts server/src/services/items.test.ts
git commit -m "feat: collapse SpaceItem union — all types use fields blob"
```

---

### Task 5: Rewrite templates.ts

**Files:**
- Modify: `server/src/services/templates.ts`

**Interfaces:**
- Consumes: `ItemSchema` from `../lib/item-schema.js`, `Block` from `./items.js`
- Produces:
  - `ItemType` (replaces `ItemTemplate`) with `schema: ItemSchema`, `capabilities: string[]`
  - `listItemTypes(userId: string): ItemType[]`
  - `getItemType(id: string): ItemType | undefined`
  - `upsertItemType(userId: string, name: string, schema: ItemSchema, capabilities: string[], blocks: Block[]): ItemType`
  - Keep `createItemTemplate`, `updateItemTemplate`, `deleteItemTemplate` as thin aliases for backward compat with any callers not yet updated

- [ ] **Step 1: Rewrite templates.ts**

```typescript
// server/src/services/templates.ts
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import type { Block } from './items.js';
import type { ItemSchema } from '../lib/item-schema.js';

export interface ItemType {
  id: string;
  user_id: string | null;
  name: string;
  schema: ItemSchema;
  capabilities: string[];
  blocks: Block[] | null;
  is_builtin: boolean;
  created_at: number;
}

interface ItemTypeRow {
  id: string;
  user_id: string | null;
  kind: string;
  name: string;
  schema: string | null;
  capabilities: string | null;
  blocks: string | null;
  is_builtin: number;
  created_at: number;
}

function hydrate(row: ItemTypeRow): ItemType {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    schema: row.schema ? JSON.parse(row.schema) as ItemSchema : {},
    capabilities: row.capabilities ? JSON.parse(row.capabilities) as string[] : [],
    blocks: row.blocks ? JSON.parse(row.blocks) as Block[] : null,
    is_builtin: row.is_builtin === 1,
    created_at: row.created_at,
  };
}

export function listItemTypes(userId: string): ItemType[] {
  const rows = getDb()
    .prepare('SELECT * FROM item_templates WHERE user_id IS NULL OR user_id = ? ORDER BY is_builtin DESC, created_at ASC')
    .all(userId) as ItemTypeRow[];
  return rows.map(hydrate);
}

export function getItemType(id: string): ItemType | undefined {
  const row = getDb().prepare('SELECT * FROM item_templates WHERE id = ?').get(id) as ItemTypeRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function upsertItemType(
  userId: string,
  name: string,
  schema: ItemSchema,
  capabilities: string[],
  blocks: Block[],
): ItemType {
  const existing = getDb().prepare(
    'SELECT id, is_builtin FROM item_templates WHERE name = ? AND (user_id = ? OR user_id IS NULL)',
  ).get(name, userId) as { id: string; is_builtin: number } | undefined;

  if (existing?.is_builtin) {
    throw new Error(`cannot redefine builtin type '${name}'`);
  }

  if (existing) {
    getDb().prepare(
      'UPDATE item_templates SET schema = ?, capabilities = ?, blocks = ? WHERE id = ?',
    ).run(JSON.stringify(schema), JSON.stringify(capabilities), JSON.stringify(blocks), existing.id);
    return getItemType(existing.id)!;
  }

  const id = newId();
  getDb().prepare(`
    INSERT INTO item_templates (id, user_id, kind, name, schema, capabilities, blocks, is_builtin, created_at)
    VALUES (?, ?, 'blocks', ?, ?, ?, ?, 0, unixepoch())
  `).run(id, userId, name, JSON.stringify(schema), JSON.stringify(capabilities), JSON.stringify(blocks));
  return getItemType(id)!;
}

// Backward-compat aliases used by routes / older callers
export const listItemTemplates = listItemTypes;
export const getItemTemplate = getItemType;

export function createItemTemplate(userId: string, name: string, blocks: Block[]): ItemType {
  return upsertItemType(userId, name, {}, [], blocks);
}

export function updateItemTemplate(id: string, blocks: Block[], name?: string): ItemType | undefined {
  const existing = getItemType(id);
  if (!existing || existing.is_builtin) return undefined;
  getDb().prepare('UPDATE item_templates SET blocks = ?, name = COALESCE(?, name) WHERE id = ?')
    .run(JSON.stringify(blocks), name ?? null, id);
  return getItemType(id);
}

export function deleteItemTemplate(id: string): boolean {
  const existing = getItemType(id);
  if (!existing || existing.is_builtin) return false;
  getDb().prepare('DELETE FROM item_templates WHERE id = ? AND is_builtin = 0').run(id);
  return true;
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|✓|✗" | tail -20
```

Expected: No new failures introduced by templates.ts changes.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/templates.ts
git commit -m "feat: templates service — add schema/capabilities, upsertItemType"
```

---

### Task 6: Rewrite item_ops.ts and MCP handler

**Files:**
- Modify: `server/src/tools/item_ops.ts`
- Modify: `server/src/mcp/handlers/items.ts`

**Interfaces:**
- Consumes:
  - `createItem`, `updateItemFields`, `getItemById`, `appendItemPageBlocks`, `updateItemPageBlocks`, `updateItemPageBlock` from `../services/items.js`
  - `listItemTypes`, `getItemType`, `upsertItemType` from `../services/templates.js`
  - `validateSchema`, `validateFields` from `../lib/item-schema.js`
  - `validateCapabilities`, `validateCapabilityFieldContracts`, `onRead`, `onCreate`, `onUpdate` from `../services/capabilities.js`
- Produces:
  - `runCreateItem` — handles `fields` param, validates against schema, fires `onCreate` hooks
  - `runUpdateItem` — handles `fields` param, fires `onUpdate` hooks
  - `runReadItem` — fires `onRead` hooks, merges extra data
  - `runDefineItemType` — validates + upserts type definition
  - `runListItemTypes` — replaces `runListItemTemplates`

- [ ] **Step 1: Rewrite item_ops.ts**

```typescript
// server/src/tools/item_ops.ts
import { getSpaceForUser, createSessionEvent } from '../db/index.js';
import { broadcast } from '../services/socket.js';
import {
  createItem,
  updateItemFields,
  updateItemPageBlocks,
  updateItemPageBlock,
  appendItemPageBlocks,
  getItemById,
  type Block,
  type SpaceItemBase,
} from '../services/items.js';
import { listItemTypes, getItemType, upsertItemType } from '../services/templates.js';
import { validateBlock, validateBlocks } from '../lib/blocks.js';
import { validateSchema, validateFields, type ItemSchema } from '../lib/item-schema.js';
import {
  validateCapabilities,
  validateCapabilityFieldContracts,
  onRead,
  onCreate,
  onUpdate,
} from '../services/capabilities.js';

function emitItemEvent(
  type: 'item_created' | 'item_updated',
  userId: string,
  sessionId: string,
  spaceId: string,
  itemId: string,
  itemName: string,
  itemType: string,
): void {
  const event = createSessionEvent({
    sessionId,
    type,
    title: `${type === 'item_created' ? 'Created' : 'Updated'} item: ${itemName}`,
    spaceId,
    itemId,
    metadata: { itemType },
  });
  broadcast(userId, {
    type: 'session_event_created',
    sessionId,
    event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
  });
}

export async function runCreateItem(
  input: {
    space_id: string;
    name: string;
    type: string;
    fields?: Record<string, unknown>;
    source_session_id?: string | null;
  },
  userId: string,
  sessionId?: string | null,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const name = input.name?.trim();
  if (!name) return 'Error: name is required';

  const itemType = getItemType(input.type);
  if (!itemType) {
    return `Error: unknown item type '${input.type}'. Use list_item_types to see available types.`;
  }

  const fields = input.fields ?? {};
  const fieldsError = validateFields(fields, itemType.schema);
  if (fieldsError) return `Error: ${fieldsError}`;

  const item = createItem({
    space_id: input.space_id,
    name,
    type: input.type,
    page_blocks: itemType.blocks ?? [],
    fields,
    source_session_id: input.source_session_id,
  });

  await onCreate(item, itemType.capabilities);

  if (sessionId) emitItemEvent('item_created', userId, sessionId, input.space_id, item.id, item.name, item.type);
  return JSON.stringify(item);
}

export async function runUpdateItem(
  input: {
    space_id: string;
    item_id: string;
    fields?: Record<string, unknown>;
    page_blocks?: Block[];
    append_blocks?: Block[];
    block_id?: string;
    block?: Block;
  },
  userId: string,
  sessionId?: string | null,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const item = getItemById(input.item_id);
  if (!item || item.space_id !== input.space_id) return `Error: item ${input.item_id} not found`;

  if (input.fields !== undefined) {
    if (typeof input.fields !== 'object' || input.fields === null) return 'Error: fields must be an object';
    const itemType = getItemType(item.type);
    if (itemType) {
      const fieldsError = validateFields({ ...item.fields, ...input.fields }, itemType.schema);
      if (fieldsError) return `Error: ${fieldsError}`;
    }
    updateItemFields(item.id, input.fields);
  }

  if (input.page_blocks !== undefined) {
    if (!Array.isArray(input.page_blocks)) return 'Error: page_blocks must be an array';
    const blocksError = validateBlocks(input.page_blocks);
    if (blocksError) return `Error: ${blocksError}`;
    updateItemPageBlocks(item.id, input.page_blocks);
  }

  if (input.append_blocks !== undefined) {
    if (!Array.isArray(input.append_blocks)) return 'Error: append_blocks must be an array';
    const blocksError = validateBlocks(input.append_blocks);
    if (blocksError) return `Error: ${blocksError}`;
    appendItemPageBlocks(item.id, input.append_blocks);
  }

  if (input.block_id !== undefined) {
    if (!input.block || typeof input.block !== 'object') return 'Error: block is required when block_id is set';
    const blockError = validateBlock(input.block, 'block');
    if (blockError) return `Error: ${blockError}`;
    const found = updateItemPageBlock(item.id, input.block_id, input.block);
    if (!found) return `Error: no block with id '${input.block_id}' on item ${item.id}`;
  }

  const updated = getItemById(item.id)!;
  const itemType = getItemType(updated.type);
  if (itemType) await onUpdate(updated, itemType.capabilities);

  if (sessionId) emitItemEvent('item_updated', userId, sessionId, input.space_id, updated.id, updated.name, updated.type);
  return JSON.stringify(updated);
}

export async function runReadItem(
  input: { space_id: string; item_id: string },
  userId: string,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const item = getItemById(input.item_id);
  if (!item || item.space_id !== input.space_id) return `Error: item ${input.item_id} not found`;

  const itemType = getItemType(item.type);
  const caps = itemType?.capabilities ?? [];
  const extra = await onRead(item, caps);

  return JSON.stringify({ ...item, ...extra });
}

export async function runListItemTypes(userId: string): Promise<string> {
  return JSON.stringify(listItemTypes(userId));
}

export async function runDefineItemType(
  input: {
    name: string;
    schema: unknown;
    capabilities: unknown;
    blocks: Block[];
  },
  userId: string,
): Promise<string> {
  const name = input.name?.trim();
  if (!name) return 'Error: name is required';

  const schemaError = validateSchema(input.schema);
  if (schemaError) return `Error: ${schemaError}`;

  const capsError = validateCapabilities(input.capabilities);
  if (capsError) return `Error: ${capsError}`;

  const contractError = validateCapabilityFieldContracts(
    input.schema as ItemSchema,
    input.capabilities as string[],
  );
  if (contractError) return `Error: ${contractError}`;

  if (!Array.isArray(input.blocks)) return 'Error: blocks must be an array';
  const blocksError = validateBlocks(input.blocks);
  if (blocksError) return `Error: ${blocksError}`;

  try {
    const itemType = upsertItemType(
      userId,
      name,
      input.schema as ItemSchema,
      input.capabilities as string[],
      input.blocks,
    );
    return JSON.stringify(itemType);
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

// Legacy aliases kept for callers not yet updated
export const runListItemTemplates = runListItemTypes;
export async function runCreateItemTemplate(
  input: { name: string; blocks: Block[] },
  userId: string,
): Promise<string> {
  return runDefineItemType({ name: input.name, schema: {}, capabilities: [], blocks: input.blocks }, userId);
}
```

- [ ] **Step 2: Rewrite MCP handler items.ts**

```typescript
// server/src/mcp/handlers/items.ts
import { registerTool } from '../registry.js';
import { getItemsForSpace, type Block } from '../../services/items.js';
import {
  runCreateItem,
  runUpdateItem,
  runReadItem,
  runListItemTypes,
  runDefineItemType,
} from '../../tools/item_ops.js';

export function registerItemHandlers(): void {
  registerTool({
    name: 'list_items',
    description: 'List all items in a space',
    inputSchema: {
      type: 'object',
      properties: { space_id: { type: 'string' } },
      required: ['space_id'],
    },
    handler: async (args, _userId) => JSON.stringify(getItemsForSpace(args.space_id as string), null, 2),
  });

  registerTool({
    name: 'read_item',
    description: 'Read the content of a space item. For file-readable items, includes file content.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
      },
      required: ['space_id', 'item_id'],
    },
    handler: async (args, userId) =>
      runReadItem({ space_id: args.space_id as string, item_id: args.item_id as string }, userId),
  });

  registerTool({
    name: 'create_item',
    description: 'Create a new item in a space. Use list_item_types to see available types and their required fields.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', description: 'Type ID from list_item_types (e.g. blank, spec, repo)' },
        fields: { type: 'object', description: 'Typed field values — validated against the type schema' },
      },
      required: ['space_id', 'name', 'type'],
    },
    handler: async (args, userId, sessionId) =>
      runCreateItem(
        {
          space_id: args.space_id as string,
          name: args.name as string,
          type: args.type as string,
          fields: args.fields as Record<string, unknown> | undefined,
          source_session_id: sessionId,
        },
        userId,
        sessionId,
      ),
  });

  registerTool({
    name: 'update_item',
    description: "Update an item's fields and/or page blocks. fields uses patch semantics (merged). Use append_blocks to add blocks without a full read.",
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        fields: { type: 'object', description: 'Patch typed fields — merged into existing values' },
        page_blocks: { type: 'array', description: 'Full replacement of all page blocks' },
        append_blocks: { type: 'array', description: 'Append blocks after existing content' },
        block_id: { type: 'string', description: 'Patch a single block by its id' },
        block: { type: 'object', description: 'Replacement block when block_id is set' },
      },
      required: ['space_id', 'item_id'],
    },
    handler: async (args, userId, sessionId) =>
      runUpdateItem(
        {
          space_id: args.space_id as string,
          item_id: args.item_id as string,
          fields: args.fields as Record<string, unknown> | undefined,
          page_blocks: args.page_blocks as Block[] | undefined,
          append_blocks: args.append_blocks as Block[] | undefined,
          block_id: args.block_id as string | undefined,
          block: args.block as Block | undefined,
        },
        userId,
        sessionId,
      ),
  });

  registerTool({
    name: 'list_item_types',
    description: 'List all available item types with their schema, capabilities, and default block layout',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => runListItemTypes(userId),
  });

  registerTool({
    name: 'define_item_type',
    description: 'Define a new item type with a backend schema (typed fields), capability primitives, and default frontend blocks. Call again with the same name to update.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the type' },
        schema: {
          type: 'object',
          description: 'Field definitions: { fieldName: { type: "string"|"number"|"boolean"|"enum", required?: boolean, options?: string[] } }',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Platform capability primitives: git-aware, file-readable, web-fetchable, embeddable, schedulable',
        },
        blocks: {
          type: 'array',
          description: 'Default page block layout for new items of this type',
        },
      },
      required: ['name', 'schema', 'capabilities', 'blocks'],
    },
    handler: async (args, userId) =>
      runDefineItemType(
        {
          name: args.name as string,
          schema: args.schema,
          capabilities: args.capabilities,
          blocks: args.blocks as Block[],
        },
        userId,
      ),
  });
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|Error" | tail -20
```

Expected: item_ops tests pass. TypeScript compilation errors in other files (worktree, routes, etc.) may show — those are fixed next.

- [ ] **Step 4: Commit**

```bash
git add server/src/tools/item_ops.ts server/src/mcp/handlers/items.ts
git commit -m "feat: define_item_type tool, fields support in create/update/read"
```

---

### Task 7: Update all RepoItem/FileItem consumers

**Files:**
- Modify: `server/src/lib/worktree.ts`
- Modify: `server/src/tools/project_query.ts`
- Modify: `server/src/tools/project_ops.ts`
- Modify: `server/src/tools/file_ops.ts`
- Modify: `server/src/tools/run_command.ts`
- Modify: `server/src/mcp/handlers/git.ts`
- Modify: `server/src/mcp/handlers/knowledge.ts`
- Modify: `server/src/services/agent.ts`
- Modify: `server/src/services/context.ts`

**Pattern:** Replace `item.type === 'repo'` checks with `item.fields.repo_path` existence or capability checks. Replace `(item as RepoItem).repo_path` with `item.fields.repo_path as string`.

- [ ] **Step 1: Update worktree.ts**

Change the import and parameter type — `RepoItem` becomes `SpaceItemBase`:

```typescript
// server/src/lib/worktree.ts
import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import {
  getDataDir,
  getAgentWorktree,
  createAgentWorktree,
  updateAgentWorktreePath,
  type DbAgentWorktree,
} from '../db/index.js';
import type { SpaceItemBase } from '../services/items.js';

export async function ensureWorktree(repoItem: SpaceItemBase, sessionId: string): Promise<DbAgentWorktree> {
  const repoPath = repoItem.fields.repo_path as string;
  const existing = getAgentWorktree(repoItem.id, sessionId);
  if (existing) {
    try {
      await fs.access(existing.worktree_path);
      return existing;
    } catch {
      // worktree directory was removed externally; recreate below
    }
  }

  const git = simpleGit(repoPath);
  await ensureInitialCommit(git);

  const branch = existing?.branch ?? `agent/${sessionId}`;
  const worktreePath = existing?.worktree_path ?? path.resolve(getDataDir(), 'worktrees', repoItem.id, sessionId);
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  await fs.rm(worktreePath, { recursive: true, force: true });

  const branches = await git.branchLocal();
  if (branches.all.includes(branch)) {
    await git.worktree(['add', '-f', worktreePath, branch]);
  } else {
    await git.worktree(['add', '-b', branch, worktreePath]);
  }

  if (existing) {
    updateAgentWorktreePath(existing.id, worktreePath);
    return { ...existing, worktree_path: worktreePath };
  }
  return createAgentWorktree(repoItem.id, sessionId, branch, worktreePath);
}
```

Keep the rest of the file (ensureInitialCommit, etc.) unchanged — only the top portion changes.

- [ ] **Step 2: Update tools/project_query.ts**

Replace `RepoItem` import and cast:

```typescript
// Find line: import { getItemById, type RepoItem } from '../services/items.js';
// Replace with:
import { getItemById } from '../services/items.js';

// Find line: const repoPath = (repoItem as RepoItem).repo_path;
// Replace with:
const repoPath = repoItem.fields.repo_path as string;
```

- [ ] **Step 3: Update tools/project_ops.ts**

```typescript
// Find: import { getItemsForSpace, createRepoItem, type SpaceItem, type RepoItem } from '../services/items.js';
// Replace with:
import { getItemsForSpace, createItem } from '../services/items.js';

// Find: createRepoItem({ space_id: id, name: input.name, repo_path: repoPath });
// Replace with:
createItem({ space_id: id, name: input.name, type: 'repo', fields: { repo_path: repoPath } });

// Find: .filter((item): item is RepoItem => item.type === 'repo')
// .map(item => item.repo_path);
// Replace with:
.filter(item => item.type === 'repo')
.map(item => item.fields.repo_path as string);
```

- [ ] **Step 4: Update tools/file_ops.ts**

```typescript
// Find: import { getItemById, type RepoItem } from '../services/items.js';
// Replace with:
import { getItemById } from '../services/items.js';

// Find: return (await ensureWorktree(repoItem as RepoItem, sessionId)).worktree_path;
// Replace with:
return (await ensureWorktree(repoItem, sessionId)).worktree_path;
```

- [ ] **Step 5: Update tools/run_command.ts**

```typescript
// Find: import { getItemById, type RepoItem } from '../services/items.js';
// Replace with:
import { getItemById } from '../services/items.js';

// Find: cwd = (repoItem as RepoItem).repo_path;
// Replace with:
cwd = repoItem.fields.repo_path as string;
```

- [ ] **Step 6: Update mcp/handlers/git.ts**

```typescript
// Find: if (!item || item.space_id !== args.space_id || item.type !== 'repo') {
// Replace with:
if (!item || item.space_id !== args.space_id || !item.fields.repo_path) {

// Find: const worktree = await ensureWorktree(item as import('../../services/items.js').RepoItem, newId());
// Replace with:
const worktree = await ensureWorktree(item, newId());
```

- [ ] **Step 7: Update mcp/handlers/knowledge.ts**

```typescript
// Find: await buildGraph((item as import('../../services/items.js').RepoItem).repo_path, item.id, null);
// Replace with:
await buildGraph(item.fields.repo_path as string, item.id, null);
```

- [ ] **Step 8: Update services/agent.ts**

```typescript
// Find: import { getItemsForSpace, type RepoItem } from './items.js';
// Replace with:
import { getItemsForSpace } from './items.js';

// Find: .filter((item): item is RepoItem => item.type === 'repo');
// Replace with:
.filter(item => item.type === 'repo');

// Find: const repoPath = repoItems[0].repo_path;
// Replace with:
const repoPath = repoItems[0].fields.repo_path as string;
```

- [ ] **Step 9: Update services/context.ts**

```typescript
// Find: import { getItemsForSpace, type RepoItem } from './items.js';
// Replace with:
import { getItemsForSpace } from './items.js';

// Find: .filter((item): item is RepoItem => item.type === 'repo');
// Replace with:
.filter(item => item.type === 'repo');

// Find: const repoPath = repoItems.length === 1 ? repoItems[0].repo_path : null;
// Replace with:
const repoPath = repoItems.length === 1 ? repoItems[0].fields.repo_path as string : null;

// Find: const detected = repoItems.map(item => detectCapabilities(item.id, item.repo_path));
// Replace with:
const detected = repoItems.map(item => detectCapabilities(item.id, item.fields.repo_path as string));

// Find: const repoList = repoItems.map(item => `${item.name} (item_id: ${item.id}, path: ${item.repo_path})`).join('; ');
// Replace with:
const repoList = repoItems.map(item => `${item.name} (item_id: ${item.id}, path: ${item.fields.repo_path})`).join('; ');
```

- [ ] **Step 10: Run tests**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|Error" | tail -20
```

Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add server/src/lib/worktree.ts server/src/tools/project_query.ts server/src/tools/project_ops.ts server/src/tools/file_ops.ts server/src/tools/run_command.ts server/src/mcp/handlers/git.ts server/src/mcp/handlers/knowledge.ts server/src/services/agent.ts server/src/services/context.ts
git commit -m "feat: update all consumers from RepoItem/FileItem to fields.repo_path"
```

---

### Task 8: Update routes

**Files:**
- Modify: `server/src/routes/spaces.ts`
- Modify: `server/src/routes/sessions.ts`

**Context:**
- `spaces.ts` creates repo and file items via `createRepoItem`/`createFileItem`, and has a `requireRepoItem` helper that checks `item.type === 'repo'`
- `sessions.ts` has two SQL queries that JOIN `space_repos` — these need to use `json_extract(si.fields, '$.repo_path')` instead

- [ ] **Step 1: Update routes/spaces.ts**

```typescript
// Find: import {
//   createFileItem,
//   createRepoItem,
//   ...
//   type RepoItem,
//   type FileItem,
// } from '../services/items.js';
// Replace with:
import {
  createItem,
  registerFileItem,
  getItemById,
  getItemsForSpace,
  deleteItem,
  updateTaskDone,
  mimeForPath,
  type SpaceItemBase,
} from '../services/items.js';

// Find: function requireRepoItem(
//   req: AuthedRequest,
//   res: Response,
// ): RepoItem | undefined {
//   ...
//   return item as RepoItem;
// }
// Replace with:
function requireRepoItem(
  req: AuthedRequest,
  res: Response,
): SpaceItemBase | undefined {
  const { spaceId, itemId } = req.params;
  const item = getItemById(itemId);
  if (!item || item.space_id !== spaceId || !item.fields.repo_path) {
    res.status(404).json({ error: 'repo item not found' });
    return undefined;
  }
  return item;
}

// Find (POST /:spaceId/items/repo):
//   res.status(201).json(createRepoItem({
//     ...
//   }));
// Replace with:
  res.status(201).json(createItem({
    space_id: req.params.spaceId,
    name: req.body.name,
    type: 'repo',
    fields: {
      repo_path: req.body.repo_path,
      default_branch: req.body.default_branch ?? null,
    },
    source_session_id: null,
  }));

// Find (POST /:spaceId/items/file):
//   res.status(201).json(createFileItem({
//     ...
//   }));
// Replace with:
  res.status(201).json(createItem({
    space_id: req.params.spaceId,
    name: req.body.name,
    type: 'file',
    fields: {
      file_path: req.body.file_path,
      size_bytes: req.body.size_bytes ?? null,
      mime_type: req.body.mime_type ?? null,
    },
    source_session_id: null,
  }));

// Find (GET item content — uses mime_type):
//   res.type(item.type === 'file' ? ((item as FileItem).mime_type ?? 'application/octet-stream') : 'application/octet-stream').send(content);
// Replace with:
  res.type(typeof item.fields.mime_type === 'string' ? item.fields.mime_type : 'application/octet-stream').send(content);

// Find all uses of item.repo_path in routes/spaces.ts:
// Replace with: item.fields.repo_path as string
// (covers directory listing, file reading, workspace.md routes, detectCapabilities call)
```

- [ ] **Step 2: Update routes/sessions.ts**

Two SQL queries join `space_repos`. Replace with `json_extract`:

```typescript
// Find:
//   SELECT w.id, w.branch, w.worktree_path, sr.repo_path, p.name AS project_name
//   FROM agent_worktrees w
//   ...
//   JOIN space_repos sr ON sr.item_id = w.item_id
// Replace with:
//   SELECT w.id, w.branch, w.worktree_path, json_extract(si.fields, '$.repo_path') AS repo_path, p.name AS project_name
//   FROM agent_worktrees w
//   ...
//   JOIN space_items si ON si.id = w.item_id

// Find:
//   SELECT w.branch, sr.repo_path
//   FROM agent_worktrees w
//   ...
//   JOIN space_repos sr ON sr.item_id = w.item_id
// Replace with:
//   SELECT w.branch, json_extract(si.fields, '$.repo_path') AS repo_path
//   FROM agent_worktrees w
//   ...
//   JOIN space_items si ON si.id = w.item_id
```

- [ ] **Step 3: Also update definitions.ts tool description if needed**

```bash
grep -n "repo_path\|RepoItem\|FileItem\|space_repos\|space_files\|list_item_templates\|create_item_template" /Users/zack/Documents/GitHub/unnamedproject/server/src/tools/definitions.ts | head -20
```

Update any description strings referencing `repo_path`, `list_item_templates`, or `create_item_template` to reference the new tools.

- [ ] **Step 4: Run tests**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|Error" | tail -20
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/spaces.ts server/src/routes/sessions.ts server/src/tools/definitions.ts
git commit -m "feat: update routes to use unified item fields"
```

---

### Task 9: TypeScript build check + full test pass

**Files:** No new changes — verification only.

- [ ] **Step 1: Kill and restart server cleanly**

```bash
lsof -ti :3000 | xargs kill -9 2>/dev/null; true
rm -rf /Users/zack/Documents/GitHub/unnamedproject/server/data
mkdir /Users/zack/Documents/GitHub/unnamedproject/server/data
cd /Users/zack/Documents/GitHub/unnamedproject && npm run dev --prefix server > /tmp/server.log 2>&1 &
sleep 5 && grep -E "Error|migration|running" /tmp/server.log | head -20
```

Expected: Migration 23 applied, server running on port 3000.

- [ ] **Step 2: Re-register test user**

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"thelegitblitz@gmail.com","password":"test1234"}'
```

Expected: `{"token":"..."}` — confirms DB schema is correct and auth works.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject && npm run test --prefix server -- --reporter=verbose 2>&1 | tail -30
```

Expected: All tests PASS, 0 failures.

- [ ] **Step 4: TypeScript build check**

```bash
cd /Users/zack/Documents/GitHub/unnamedproject/server && npx tsc --noEmit 2>&1 | head -40
```

Expected: No TypeScript errors. If errors exist, fix them before proceeding.

- [ ] **Step 5: Smoke test new tools via curl**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"thelegitblitz@gmail.com","password":"test1234"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Get a space first
curl -s http://localhost:3000/api/spaces -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null || echo "No spaces yet — that's fine"
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: unified item type system complete — define_item_type, fields, capabilities"
```
