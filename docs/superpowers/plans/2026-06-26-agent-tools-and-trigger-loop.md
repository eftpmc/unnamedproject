# Agent Tools + Trigger Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the Plan 1 services (documents/projects/triggers) to the agent as a small, uniform MCP tool surface; build the trigger runner that fires scheduled playbooks; rewrite the HTTP routes and the agent system prompt around Projects/Documents/Triggers; and delete the entire dead item/blocks/schema/capabilities/DAG subsystem. This is **Plan 2 of 3**. Requires Plan 1 merged.

**Architecture:** MCP handlers (`mcp/handlers/*`) register tools into a registry; the agent calls them. A trigger is stored by Plan 1's `triggers` service; a scheduler polls `triggers.next_run_at`, starts a session pinned to the space seeded with the playbook document body, and computes the next cron time. Removing the legacy code is a task, not an afterthought — the codebase must compile and tests pass at each commit.

**Tech Stack:** TypeScript ESM, better-sqlite3, MCP tool registry, Vitest, cron-parser (new dep).

## Global Constraints

- Same as Plan 1: ESM `.js` specifiers, `newId`, `getDataDir`, `cd server && npx vitest run`, DB is disposable.
- After this plan, **no source file may import** `services/items.js`, `services/templates.js`, `lib/blocks.js`, `lib/item-schema.js`, `services/capabilities.js`, `services/projectCapabilities.js` (as item-coupled), `services/scheduled_tasks.js`, or `tools/item_ops.js`. Those files are deleted.
- Tool naming: `write_document`, `read_document`, `list_documents`, `patch_frontmatter`, `create_project`, `link_project`, `list_projects`, `create_trigger`, `list_triggers`, `delete_trigger`.
- `mcp/handlers/index.ts` registration list must be updated whenever a handler module is added or removed.

---

## File Structure

- **Delete:** `services/items.ts`, `services/templates.ts`, `lib/blocks.ts`, `lib/blocks.test.ts`, `lib/item-schema.ts`, `lib/item-schema.test.ts`, `services/capabilities.ts`, `tools/item_ops.ts`, `tools/item_ops.test.ts`, `services/scheduled_tasks.ts`, `mcp/handlers/items.ts`, `mcp/handlers/schedules.ts`, `routes/scheduled_tasks.ts`. Evaluate `services/projectCapabilities.ts`: keep the pure `detectCapabilities(repoPath)` if still used by `project_query`, drop its item coupling.
- **Create:** `mcp/handlers/documents.ts`, `mcp/handlers/projects.ts`, `mcp/handlers/triggers.ts`, `services/triggerRunner.ts`, `lib/cron.ts`.
- **Rewrite:** `services/context.ts` (`projectContextBlock`, tool lists, the Items prose), `services/scheduler.ts` (poll triggers, not scheduled_tasks), `routes/spaces.ts` (documents/projects/triggers endpoints), `mcp/handlers/index.ts`, `db/index.ts` (drop `scheduled_tasks` table + its accessors).
- **Create tests:** `tests/triggerRunner.test.ts`, `tests/cron.test.ts`, `src/routes/spaces-content.test.ts`, and tool-handler smoke tests as noted.

---

## Task 1: Delete the dead subsystem and make the build green

This is one task because the codebase must compile as a unit — you cannot delete `services/items.ts` without simultaneously removing every importer.

**Files:**
- Delete the files listed under "Delete" above.
- Modify: `mcp/handlers/index.ts`, `services/context.ts`, `db/index.ts`, `routes/index.ts` (or wherever routers mount), `tests/db.test.ts` (already done in Plan 1).

- [ ] **Step 1: Remove handler registration**

In `mcp/handlers/index.ts`, delete the `registerItemHandlers` and `registerScheduleHandlers` imports and calls. (Document/project/trigger handlers are added in later tasks.)

- [ ] **Step 2: Delete the dead files**

```bash
cd server && git rm \
  src/services/items.ts src/services/templates.ts \
  src/lib/blocks.ts src/lib/blocks.test.ts \
  src/lib/item-schema.ts src/lib/item-schema.test.ts \
  src/services/capabilities.ts \
  src/tools/item_ops.ts src/tools/item_ops.test.ts \
  src/services/scheduled_tasks.ts \
  src/mcp/handlers/items.ts src/mcp/handlers/schedules.ts \
  src/routes/scheduled_tasks.ts
```

- [ ] **Step 3: Unmount deleted routers**

Find where `scheduled_tasks` router is mounted (search `scheduled_tasks` in `index.ts`/route index) and remove the import + `app.use(...)`. Remove item-route registration from `routes/spaces.ts` temporarily by deleting the item endpoint handlers (`/:spaceId/items*`, `/item-templates*`, `/:spaceId/items/:itemId/*`). The space CRUD endpoints (`GET/POST/PATCH/DELETE /`, `/:id`) stay. New content endpoints come in Task 6.

- [ ] **Step 4: Drop the `scheduled_tasks` table and accessors**

In `db/index.ts`: remove the `scheduled_tasks` `CREATE TABLE` from the bootstrap and delete the functions `getScheduledTasksForUser`, `getScheduledTaskForUser`, `createScheduledTask`, `updateScheduledTask`, `deleteScheduledTask`, `markScheduledTaskRun`, `getDueScheduledTasks`. Add `expect(names).not.toContain('scheduled_tasks');` to `tests/db.test.ts`.

- [ ] **Step 5: Stub the scheduler so it compiles**

In `services/scheduler.ts`, replace the body with a no-op that will be filled in Task 5:

```typescript
export function startScheduler(): NodeJS.Timeout {
  // Trigger polling is wired in Task 5 (triggerRunner).
  return setInterval(() => {}, 60 * 60 * 1000);
}
```

- [ ] **Step 6: Rewrite `projectContextBlock` in `services/context.ts` to use the new services**

Replace the item-based implementation (`getItemsForSpace(...).filter(type==='repo')`, `listItemTypes`, `readWorkspaceMd`) with project + document listing:

```typescript
import { listProjects } from './projects.js';
import { listDocuments } from './documents.js';
// remove: import { getItemsForSpace } from './items.js';
// remove: import { listItemTypes } from './templates.js';

function projectContextBlock(space: DbSpace, _userId: string): string {
  const projects = listProjects(space.id);
  const docs = listDocuments(space.id);
  const header = `## Active space: **${space.name}** (id: ${space.id})${space.description ? ' — ' + space.description : ''}`;

  const projectLine = projects.length > 0
    ? `\nProjects (git repos) in this space: ${projects.map(p => `${p.name} (project_id: ${p.id}, path: ${p.repo_path})`).join('; ')}. Use code tools with the selected project_id.`
    : `\nNo projects (git repos) in this space yet. Create one with create_project, or work in documents.`;

  const docTypes = [...new Set(docs.map(d => d.type).filter(Boolean))];
  const docLine = docs.length > 0
    ? `\nDocuments: ${docs.length} total${docTypes.length ? ` (types: ${docTypes.join(', ')})` : ''}. Use list_documents to query by type/status, read_document before editing.`
    : `\nNo documents yet. Author markdown with write_document.`;

  return header + projectLine + docLine;
}
```

Also delete the now-unused `readWorkspaceMd` helper and its `getDataDir`/`path` usages if they become dead.

- [ ] **Step 7: Update the tool-list strings in `context.ts`**

Replace the `list_items, create_item, read_item, update_item, list_item_types, define_item_type` and `list_scheduled_tasks, create_scheduled_task, update_scheduled_task` substrings (both branches around lines 30–31) with: `write_document, read_document, list_documents, patch_frontmatter, create_project, link_project, list_projects, create_trigger, list_triggers, delete_trigger`. Replace the entire `## Items`, `## Item types`, `## File storage in items`, `## Relations between items`, `## Interactive items`, and runbook prose sections with the new doctrine:

```
## Documents
A document is a markdown file in the space, the source of truth on disk. Author with write_document (path, title, frontmatter, body). Frontmatter is YAML key/values used for tracking and querying — set `type` (e.g. application, resume, workflow, note) and `status` where relevant. Query with list_documents({ type, frontmatter }); a tracker is just a query grouped by status. Update a status cheaply with patch_frontmatter — do NOT rewrite the whole file for a field change. Link documents with [[wikilinks]] in the body.

## Projects
A project is a git repo in the space (0..n). Create one with create_project, or link an existing path with link_project. Code tools (read/write/edit/bash/git) operate inside a project — pass its project_id.

## Triggers (the automation loop)
A trigger runs a playbook document (a document with frontmatter type: workflow) on a schedule. Create with create_trigger({ kind: 'schedule', schedule_cron, playbook_id }). When it fires, a new chat starts pinned to this space seeded with the playbook body; you execute it using the space's connections and tools, writing results back as documents and frontmatter updates. This is how recurring flows (e.g. "search internships each morning, draft applications, track status") run end to end.
```

- [ ] **Step 8: Compile and run the full test suite**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: Compiles clean. Tests that exercised deleted features are gone (removed in Step 2); remaining suite passes. If any non-deleted file still imports a removed module, fix it now.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: delete item/blocks/schema/capabilities/DAG subsystem; rebuild context around projects+documents"
```

---

## Task 2: cron helper + dependency

**Files:**
- Modify: `server/package.json`
- Create: `server/src/lib/cron.ts`, `server/tests/cron.test.ts`

**Interfaces:**
- Produces: `nextCronRun(cron: string, afterUnixSeconds: number): number` — next fire time (unix seconds) strictly after the given time.

- [ ] **Step 1: Install cron-parser**

Run: `cd server && npm install cron-parser@^4.9.0`
Expected: dependency added.

- [ ] **Step 2: Write the failing test**

```typescript
// server/tests/cron.test.ts
import { describe, it, expect } from 'vitest';
import { nextCronRun } from '../src/lib/cron.js';

describe('nextCronRun', () => {
  it('computes the next daily 08:00 UTC run', () => {
    // 2026-06-26T09:00:00Z = 1782032400
    const base = Date.UTC(2026, 5, 26, 9, 0, 0) / 1000;
    const next = nextCronRun('0 8 * * *', base);
    // next 08:00 is the following day
    expect(next).toBe(Date.UTC(2026, 5, 27, 8, 0, 0) / 1000);
  });

  it('throws on invalid cron', () => {
    expect(() => nextCronRun('not a cron', 0)).toThrow();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd server && npx vitest run tests/cron.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```typescript
// server/src/lib/cron.ts
import parser from 'cron-parser';

export function nextCronRun(cron: string, afterUnixSeconds: number): number {
  const interval = parser.parseExpression(cron, {
    currentDate: new Date(afterUnixSeconds * 1000),
    tz: 'UTC',
  });
  return Math.floor(interval.next().getTime() / 1000);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd server && npx vitest run tests/cron.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/lib/cron.ts server/tests/cron.test.ts
git commit -m "feat: cron next-run helper"
```

---

## Task 3: Document agent tools

**Files:**
- Create: `server/src/mcp/handlers/documents.ts`
- Modify: `server/src/mcp/handlers/index.ts`
- Test: `server/tests/documents-tools.test.ts`

**Interfaces:**
- Consumes: `writeDocument`, `readDocument`, `listDocuments`, `patchFrontmatter` from `services/documents.js`; `registerTool`, `getTool` from the registry.
- Produces: registered tools `write_document`, `read_document`, `list_documents`, `patch_frontmatter`; exported `registerDocumentHandlers()`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/documents-tools.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { registerDocumentHandlers } from '../src/mcp/handlers/documents.js';
import { getTool } from '../src/mcp/registry.js';

const SPACE = 'space-doctools';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u','dt@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u', 'S');
  registerDocumentHandlers();
});

describe('document tools', () => {
  it('write_document then list_documents by type', async () => {
    await getTool('write_document')!.handler(
      { space_id: SPACE, path: 'a.md', title: 'A', frontmatter: { type: 'note' }, body: '# A' }, 'u', null);
    const out = await getTool('list_documents')!.handler({ space_id: SPACE, type: 'note' }, 'u', null);
    expect(JSON.parse(out)).toHaveLength(1);
  });

  it('patch_frontmatter updates status', async () => {
    const created = JSON.parse(await getTool('write_document')!.handler(
      { space_id: SPACE, path: 'b.md', title: 'B', frontmatter: { type: 'application', status: 'found' }, body: '# B' }, 'u', null));
    const patched = JSON.parse(await getTool('patch_frontmatter')!.handler(
      { id: created.id, patch: { status: 'applied' } }, 'u', null));
    expect(patched.status).toBe('applied');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/documents-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

```typescript
// server/src/mcp/handlers/documents.ts
import { registerTool } from '../registry.js';
import { writeDocument, readDocument, listDocuments, patchFrontmatter } from '../../services/documents.js';

export function registerDocumentHandlers(): void {
  registerTool({
    name: 'write_document',
    description: 'Create or overwrite a markdown document in a space. Frontmatter is YAML key/values (set `type` and `status` for tracking). Body is markdown. Re-writing the same path updates it.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        path: { type: 'string', description: 'Relative path within the space, e.g. application-acme.md' },
        title: { type: 'string' },
        frontmatter: { type: 'object', description: 'YAML key/values; include type and status when relevant' },
        body: { type: 'string', description: 'Markdown body' },
      },
      required: ['space_id', 'path', 'title', 'body'],
    },
    handler: async (args, _userId, sessionId) => JSON.stringify(await writeDocument({
      space_id: args.space_id as string,
      path: args.path as string,
      title: args.title as string,
      frontmatter: args.frontmatter as Record<string, unknown> | undefined,
      body: args.body as string,
      source_session_id: sessionId,
    })),
  });

  registerTool({
    name: 'read_document',
    description: 'Read a document by id, including its markdown body and parsed frontmatter.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args) => {
      const doc = await readDocument(args.id as string);
      return doc ? JSON.stringify(doc) : `Error: document ${args.id} not found`;
    },
  });

  registerTool({
    name: 'list_documents',
    description: 'List documents in a space. Filter by type and/or exact frontmatter field values. A tracker view is just list_documents grouped by status.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        type: { type: 'string' },
        frontmatter: { type: 'object', description: 'Exact-match filters, e.g. { status: "applied" }' },
      },
      required: ['space_id'],
    },
    handler: async (args) => JSON.stringify(listDocuments(
      args.space_id as string,
      (args.type || args.frontmatter) ? { type: args.type as string | undefined, frontmatter: args.frontmatter as Record<string, unknown> | undefined } : undefined,
    )),
  });

  registerTool({
    name: 'patch_frontmatter',
    description: 'Merge a patch into a document\'s frontmatter without rewriting the body. Use for cheap status/field updates.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, patch: { type: 'object' } },
      required: ['id', 'patch'],
    },
    handler: async (args) => {
      const updated = await patchFrontmatter(args.id as string, args.patch as Record<string, unknown>);
      return updated ? JSON.stringify(updated) : `Error: document ${args.id} not found`;
    },
  });
}
```

- [ ] **Step 4: Register it**

In `mcp/handlers/index.ts`, import and call `registerDocumentHandlers()`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd server && npx vitest run tests/documents-tools.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/mcp/handlers/documents.ts server/src/mcp/handlers/index.ts server/tests/documents-tools.test.ts
git commit -m "feat: document agent tools (write/read/list/patch_frontmatter)"
```

---

## Task 4: Project agent tools

**Files:**
- Create: `server/src/mcp/handlers/projects.ts`
- Modify: `server/src/mcp/handlers/index.ts`
- Test: `server/tests/projects-tools.test.ts`

**Interfaces:**
- Consumes: `createProject`, `linkProject`, `listProjects` from `services/projects.js`.
- Produces: tools `create_project`, `link_project`, `list_projects`; `registerProjectHandlers()`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/projects-tools.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { registerProjectHandlers } from '../src/mcp/handlers/projects.js';
import { getTool } from '../src/mcp/registry.js';

const SPACE = 'space-projtools';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u','pt@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u', 'S');
  registerProjectHandlers();
});

describe('project tools', () => {
  it('create_project then list_projects', async () => {
    const created = JSON.parse(await getTool('create_project')!.handler({ space_id: SPACE, name: 'Repo' }, 'u', null));
    expect(created.origin).toBe('created');
    const list = JSON.parse(await getTool('list_projects')!.handler({ space_id: SPACE }, 'u', null));
    expect(list.map((p: { id: string }) => p.id)).toContain(created.id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/projects-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// server/src/mcp/handlers/projects.ts
import { registerTool } from '../registry.js';
import { createProject, linkProject, listProjects } from '../../services/projects.js';

export function registerProjectHandlers(): void {
  registerTool({
    name: 'create_project',
    description: 'Create a new git repo (project) inside a space. Returns the project_id and repo_path; code tools operate inside it.',
    inputSchema: {
      type: 'object',
      properties: { space_id: { type: 'string' }, name: { type: 'string' } },
      required: ['space_id', 'name'],
    },
    handler: async (args) => JSON.stringify(await createProject({ space_id: args.space_id as string, name: args.name as string })),
  });

  registerTool({
    name: 'link_project',
    description: 'Register an existing git repo path as a project in a space.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' }, name: { type: 'string' },
        repo_path: { type: 'string' }, default_branch: { type: 'string' },
      },
      required: ['space_id', 'name', 'repo_path'],
    },
    handler: async (args) => JSON.stringify(linkProject({
      space_id: args.space_id as string, name: args.name as string,
      repo_path: args.repo_path as string, default_branch: args.default_branch as string | undefined,
    })),
  });

  registerTool({
    name: 'list_projects',
    description: 'List the git repos (projects) in a space.',
    inputSchema: { type: 'object', properties: { space_id: { type: 'string' } }, required: ['space_id'] },
    handler: async (args) => JSON.stringify(listProjects(args.space_id as string)),
  });
}
```

- [ ] **Step 4: Register + run + commit**

Add `registerProjectHandlers()` to `mcp/handlers/index.ts`.
Run: `cd server && npx vitest run tests/projects-tools.test.ts` → PASS

```bash
git add server/src/mcp/handlers/projects.ts server/src/mcp/handlers/index.ts server/tests/projects-tools.test.ts
git commit -m "feat: project agent tools (create/link/list)"
```

---

## Task 5: Trigger tools + runner + scheduler wiring

**Files:**
- Create: `server/src/mcp/handlers/triggers.ts`, `server/src/services/triggerRunner.ts`
- Modify: `server/src/mcp/handlers/index.ts`, `server/src/services/scheduler.ts`, `server/src/db/index.ts` (add `getDueTriggers`)
- Test: `server/tests/triggerRunner.test.ts`

**Interfaces:**
- Consumes: `createTrigger`, `listTriggers`, `deleteTrigger`, `markTriggerRun` from `services/triggers.js`; `readDocument` from `services/documents.js`; `nextCronRun` from `lib/cron.js`; `runAgentTurn` from `services/agent.js`; `newId`, `getDb`.
- Produces:
  - `getDueTriggers(nowUnix: number): Array<{ id: string; space_id: string; schedule_cron: string | null; playbook_id: string | null; user_id: string }>` in `db/index.ts` (joins `triggers`→`spaces` for `user_id`).
  - `fireTrigger(triggerId: string): Promise<void>` in `triggerRunner.ts`.
  - tools `create_trigger`, `list_triggers`, `delete_trigger`; `registerTriggerHandlers()`.

- [ ] **Step 1: Add `getDueTriggers` to `db/index.ts`**

```typescript
export function getDueTriggers(nowUnix: number): Array<{ id: string; space_id: string; schedule_cron: string | null; playbook_id: string | null; user_id: string }> {
  return getDb().prepare(`
    SELECT t.id, t.space_id, t.schedule_cron, t.playbook_id, s.user_id
    FROM triggers t JOIN spaces s ON s.id = t.space_id
    WHERE t.enabled = 1 AND t.kind = 'schedule' AND t.next_run_at IS NOT NULL AND t.next_run_at <= ?
  `).all(nowUnix) as Array<{ id: string; space_id: string; schedule_cron: string | null; playbook_id: string | null; user_id: string }>;
}
```

- [ ] **Step 2: Write the failing runner test**

```typescript
// server/tests/triggerRunner.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';

const runAgentTurn = vi.fn(async () => {});
vi.mock('../src/services/agent.js', () => ({ runAgentTurn }));

import { initDb, getDb } from '../src/db/index.js';
import { writeDocument } from '../src/services/documents.js';
import { createTrigger, listTriggers } from '../src/services/triggers.js';
import { fireTrigger } from '../src/services/triggerRunner.js';

const SPACE = 'space-runner';
beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u','run@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u', 'S');
});

describe('fireTrigger', () => {
  it('seeds a session from the playbook and advances next_run_at', async () => {
    const playbook = await writeDocument({ space_id: SPACE, path: 'flow.md', title: 'Flow', frontmatter: { type: 'workflow' }, body: 'Search internships and draft applications.' });
    const t = createTrigger({ space_id: SPACE, kind: 'schedule', schedule_cron: '0 8 * * *', playbook_id: playbook.id, next_run_at: 1 });

    await fireTrigger(t.id);

    expect(runAgentTurn).toHaveBeenCalledOnce();
    const sessions = getDb().prepare('SELECT * FROM sessions WHERE pinned_space_id = ?').all(SPACE) as Array<{ id: string }>;
    expect(sessions.length).toBe(1);
    const msg = getDb().prepare('SELECT content FROM messages').get() as { content: string };
    expect(msg.content).toContain('Search internships');
    const updated = listTriggers(SPACE).find(x => x.id === t.id)!;
    expect(updated.next_run_at).toBeGreaterThan(1);
    expect(updated.last_run_at).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd server && npx vitest run tests/triggerRunner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the runner**

```typescript
// server/src/services/triggerRunner.ts
import { getDb, getDueTriggers } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { readDocument } from './documents.js';
import { listTriggers, markTriggerRun } from './triggers.js';
import { nextCronRun } from '../lib/cron.js';
import { runAgentTurn } from './agent.js';

function triggerById(id: string) {
  return getDb().prepare('SELECT t.*, s.user_id FROM triggers t JOIN spaces s ON s.id = t.space_id WHERE t.id = ?')
    .get(id) as { id: string; space_id: string; schedule_cron: string | null; playbook_id: string | null; user_id: string } | undefined;
}

export async function fireTrigger(triggerId: string): Promise<void> {
  const trigger = triggerById(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);

  const playbook = trigger.playbook_id ? await readDocument(trigger.playbook_id) : undefined;
  const prompt = playbook
    ? `Run this playbook for space ${trigger.space_id}:\n\n${playbook.body}`
    : `Scheduled run for space ${trigger.space_id}.`;
  const title = `${playbook?.title ?? 'Scheduled run'} — ${new Date().toISOString().slice(0, 10)}`;

  const db = getDb();
  const sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id, title, pinned_space_id) VALUES (?,?,?,?)')
    .run(sessionId, trigger.user_id, title, trigger.space_id);
  const messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
    .run(messageId, sessionId, 'user', prompt);

  const next = trigger.schedule_cron ? nextCronRun(trigger.schedule_cron, Math.floor(Date.now() / 1000)) : null;
  markTriggerRun(trigger.id, next);

  await runAgentTurn(trigger.user_id, sessionId, messageId);
}

export async function runDueTriggers(): Promise<void> {
  const due = getDueTriggers(Math.floor(Date.now() / 1000));
  await Promise.all(due.map(async t => {
    try { await fireTrigger(t.id); }
    catch (err) { console.error(`[triggers] ${t.id} failed:`, err); }
  }));
}
```

- [ ] **Step 5: Implement trigger tools**

```typescript
// server/src/mcp/handlers/triggers.ts
import { registerTool } from '../registry.js';
import { createTrigger, listTriggers, deleteTrigger } from '../../services/triggers.js';
import { nextCronRun } from '../../lib/cron.js';

export function registerTriggerHandlers(): void {
  registerTool({
    name: 'create_trigger',
    description: 'Create an automation trigger. For kind=schedule, provide schedule_cron (UTC, 5-field cron) and playbook_id (a document with frontmatter type: workflow). When it fires, a chat starts pinned to the space seeded with the playbook body.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        kind: { type: 'string', enum: ['schedule', 'webhook', 'manual'] },
        schedule_cron: { type: 'string', description: '5-field cron, UTC, e.g. "0 8 * * *"' },
        playbook_id: { type: 'string', description: 'Document id of the type:workflow playbook' },
      },
      required: ['space_id', 'kind'],
    },
    handler: async (args) => {
      const cron = args.schedule_cron as string | undefined;
      const next = args.kind === 'schedule' && cron ? nextCronRun(cron, Math.floor(Date.now() / 1000)) : null;
      return JSON.stringify(createTrigger({
        space_id: args.space_id as string,
        kind: args.kind as 'schedule' | 'webhook' | 'manual',
        schedule_cron: cron ?? null,
        playbook_id: args.playbook_id as string | undefined,
        next_run_at: next,
      }));
    },
  });

  registerTool({
    name: 'list_triggers',
    description: 'List automation triggers in a space.',
    inputSchema: { type: 'object', properties: { space_id: { type: 'string' } }, required: ['space_id'] },
    handler: async (args) => JSON.stringify(listTriggers(args.space_id as string)),
  });

  registerTool({
    name: 'delete_trigger',
    description: 'Delete an automation trigger.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args) => deleteTrigger(args.id as string) ? 'deleted' : `Error: trigger ${args.id} not found`,
  });
}
```

- [ ] **Step 6: Wire scheduler + register handlers**

In `services/scheduler.ts`:

```typescript
import { runDueTriggers } from './triggerRunner.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    runDueTriggers().catch(err => console.error('[scheduler] error:', err));
  }, POLL_INTERVAL_MS);
}
```

In `mcp/handlers/index.ts`, add `registerTriggerHandlers()`.

- [ ] **Step 7: Run to verify it passes**

Run: `cd server && npx vitest run tests/triggerRunner.test.ts && npx tsc --noEmit`
Expected: PASS + clean compile.

- [ ] **Step 8: Commit**

```bash
git add server/src/mcp/handlers/triggers.ts server/src/services/triggerRunner.ts server/src/services/scheduler.ts server/src/mcp/handlers/index.ts server/src/db/index.ts server/tests/triggerRunner.test.ts
git commit -m "feat: trigger tools + runner + scheduler polling (the automation loop)"
```

---

## Task 6: HTTP routes for documents / projects / triggers

**Files:**
- Modify: `server/src/routes/spaces.ts`
- Test: `server/src/routes/spaces-content.test.ts`

**Interfaces:**
- Consumes the Plan 1 services + Task 5 services.
- Produces REST endpoints (all under the existing `requireAuthHeaderOrQuery` + `requireSpace` guards):
  - `GET /spaces/:spaceId/documents` → `listDocuments(spaceId, { type?, ...frontmatter via query })`
  - `POST /spaces/:spaceId/documents` (body: path, title, frontmatter, body) → `writeDocument`
  - `GET /spaces/:spaceId/documents/:docId` → `readDocument`
  - `PATCH /spaces/:spaceId/documents/:docId` (body: frontmatter patch and/or title/body) → `writeDocument`/`patchFrontmatter`
  - `DELETE /spaces/:spaceId/documents/:docId` → `deleteDocument`
  - `GET/POST /spaces/:spaceId/projects`, `DELETE /spaces/:spaceId/projects/:projectId`
  - `GET /spaces/:spaceId/projects/:projectId/tree|file` (repointed from the old repo-item file browser — reuse `resolveInItem` logic against `project.repo_path`)
  - `GET/POST /spaces/:spaceId/triggers`, `DELETE /spaces/:spaceId/triggers/:triggerId`

- [ ] **Step 1: Write the failing route test**

```typescript
// server/src/routes/spaces-content.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { initDb, getDb } from '../db/index.js';
import { app } from '../app.js'; // adjust to the Express app export used by other route tests

const TOKEN = 'test-token'; // mirror the auth setup in existing route tests
let spaceId = '';

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  // create user + auth token following the pattern in routes/spaces-items.test.ts
});

describe('space content routes', () => {
  it('creates and lists a document', async () => {
    const create = await request(app)
      .post(`/spaces/${spaceId}/documents`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ path: 'r.md', title: 'R', frontmatter: { type: 'resume' }, body: '# R' });
    expect(create.status).toBe(201);
    const list = await request(app)
      .get(`/spaces/${spaceId}/documents?type=resume`)
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(list.body).toHaveLength(1);
  });
});
```

> Before implementing, open `server/src/routes/spaces-items.test.ts` (being deleted) or another route test to copy the exact app import and auth/token bootstrapping, and adapt the placeholders above. Delete `spaces-items.test.ts` as part of this task.

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/routes/spaces-content.test.ts`
Expected: FAIL (routes not defined / 404).

- [ ] **Step 3: Implement the routes**

In `routes/spaces.ts`, import the services and add the endpoints. Documents example (repeat the guard pattern already in the file):

```typescript
import { writeDocument, readDocument, listDocuments, patchFrontmatter, deleteDocument } from '../services/documents.js';
import { createProject, linkProject, listProjects, getProject, deleteProject } from '../services/projects.js';
import { createTrigger, listTriggers, deleteTrigger } from '../services/triggers.js';
import { nextCronRun } from '../lib/cron.js';

router.get('/:spaceId/documents', (req, res) => {
  if (!requireSpace(req, res)) return;
  const { type, ...rest } = req.query as Record<string, string>;
  const frontmatter = Object.keys(rest).length ? rest : undefined;
  res.json(listDocuments(req.params.spaceId, (type || frontmatter) ? { type, frontmatter } : undefined));
});

router.post('/:spaceId/documents', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const { path: docPath, title, frontmatter, body } = req.body as { path?: string; title?: string; frontmatter?: Record<string, unknown>; body?: string };
  if (!docPath?.trim() || !title?.trim() || body === undefined) { res.status(400).json({ error: 'path, title, body required' }); return; }
  res.status(201).json(await writeDocument({ space_id: req.params.spaceId, path: docPath.trim(), title: title.trim(), frontmatter, body }));
});

router.get('/:spaceId/documents/:docId', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const doc = await readDocument(req.params.docId);
  if (!doc || doc.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Document not found' }); return; }
  res.json(doc);
});

router.patch('/:spaceId/documents/:docId', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const doc = await readDocument(req.params.docId);
  if (!doc || doc.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Document not found' }); return; }
  const { frontmatter, title, body } = req.body as { frontmatter?: Record<string, unknown>; title?: string; body?: string };
  if (title === undefined && body === undefined && frontmatter) {
    res.json(await patchFrontmatter(doc.id, frontmatter));
    return;
  }
  res.json(await writeDocument({
    space_id: doc.space_id, path: doc.path,
    title: title ?? doc.title,
    frontmatter: { ...doc.frontmatter, ...(frontmatter ?? {}) },
    body: body ?? doc.body,
  }));
});

router.delete('/:spaceId/documents/:docId', async (req, res) => {
  if (!requireSpace(req, res)) return;
  const doc = await readDocument(req.params.docId);
  if (!doc || doc.space_id !== req.params.spaceId) { res.status(404).json({ error: 'Document not found' }); return; }
  await deleteDocument(doc.id);
  res.status(204).end();
});
```

Add the analogous `projects` and `triggers` endpoints (list/create/delete; for triggers compute `next_run_at` via `nextCronRun` when `kind==='schedule'`). For `projects/:projectId/tree` and `/file`, reuse the path-escape guard (`resolveInItem` → rename to `resolveInRepo`) against `getProject(projectId).repo_path`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/routes/spaces-content.test.ts && npx tsc --noEmit`
Expected: PASS + clean compile.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/spaces.ts server/src/routes/spaces-content.test.ts
git rm server/src/routes/spaces-items.test.ts
git commit -m "feat: REST routes for documents/projects/triggers; remove item routes"
```

---

## Task 7: Full backend test + lint gate

- [ ] **Step 1: Run the entire suite and typecheck**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: All green, no references to deleted modules.

- [ ] **Step 2: Grep for orphans**

Run: `cd server && grep -rn "services/items\|item_ops\|space_items\|scheduled_tasks\|lib/blocks\|item-schema\|define_item_type" src | grep -v node_modules`
Expected: no output (the only allowed hits are inside deletion-confirmation comments, if any).

- [ ] **Step 3: Commit any cleanup**

```bash
git add -A && git commit -m "chore: confirm no orphan references to removed item subsystem"
```

---

## Self-Review

- **Spec coverage:** document tools (Task 3), project tools (Task 4), trigger tools + runner + scheduler (Task 5), REST routes (Task 6), dead-code deletion + context rewrite (Task 1), cron (Task 2), final gate (Task 7). The agent system prompt is rewritten in Task 1 Step 7. ✓
- **Placeholder scan:** The route test (Task 6 Step 1) intentionally references the existing test bootstrap to copy — flagged explicitly, not a silent TBD. All tool/runner code is complete.
- **Type consistency:** Tool handler signature `(args, userId, sessionId) => Promise<string>` matches `McpToolDef`. `getDueTriggers` shape matches `fireTrigger`'s `triggerById`. `createTrigger`/`nextCronRun` signatures match Plan 1 and Task 2.

---

## Note for Plan 3 (web)

Backend now serves `/spaces/:id/documents|projects|triggers`. The web app still imports the deleted item endpoints and `Block`/`SpaceItem` types — it will not build until Plan 3. Run Plans 2 and 3 back-to-back, or keep the web app on the previous commit until Plan 3 lands.
