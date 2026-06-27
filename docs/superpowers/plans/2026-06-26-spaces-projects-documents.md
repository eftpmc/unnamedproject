# Spaces / Projects / Documents — Core Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded `space_items` abstraction with two concrete, filesystem-backed concepts — **Projects** (git repos, 0..n per space) and **Documents** (markdown files indexed by frontmatter) — and a **Triggers** primitive that lets the agent run scheduled playbooks. This is **Plan 1 of 3** (core backend data model). Plans 2 (agent tools + trigger runner) and 3 (web UI) follow.

**Architecture:** A Space is a container directory on disk: `spaces/<spaceId>/` holds `documents/` (a git-backed folder of markdown files, source of truth) and `projects/<projectId>/` (agent-created repos) or references to external repo paths. SQLite stops storing content; it becomes a thin index over the filesystem. `documents.frontmatter` (JSON) is queried with `json_extract`, the same pattern the old `space_items.fields` used, so a "tracker" is just a query, not a feature.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), better-sqlite3, Express, Vitest, simple-git, gray-matter (new dep) for frontmatter parsing.

## Global Constraints

- The database is disposable (user confirmed "nuke the db"). Do **not** write data-preserving migrations for the dropped tables. Establish a clean baseline schema instead.
- **Proper names, no aliases.** `projects` now means *git repo within a space*. Every legacy column named `project_id` that actually referenced a space must be renamed to `space_id`; the per-repo column `agent_worktrees.project_id` keeps the name and references the new `projects` table.
- ESM: all relative imports end in `.js`. New files are `.ts`.
- IDs: `import { newId } from '../lib/ids.js'` (nanoid, 21 chars).
- Filesystem root: `getDataDir()` from `../db/index.js`.
- Tests: `cd server && npx vitest run <path>`. Tests set `process.env.DATA_DIR` to a temp dir and call `initDb()`.
- Git: use `simple-git` (already a dependency), matching `src/tools/git_op.ts`.

---

## File Structure

- `server/src/db/index.ts` — **modify**: rewrite the bootstrap schema (the `CREATE TABLE` block run by `initDb`) to the target; drop all legacy content/DAG tables; add `projects`, `documents`, `triggers`; widen `connections.type`; add typed accessor functions.
- `server/src/lib/spaceFs.ts` — **create**: filesystem layout helpers + git-for-documents.
- `server/src/lib/frontmatter.ts` — **create**: parse/serialize markdown frontmatter (thin wrapper over gray-matter).
- `server/src/services/documents.ts` — **create**: document CRUD over disk + index sync.
- `server/src/services/projects.ts` — **create**: repo create/link + index.
- `server/src/services/triggers.ts` — **create**: trigger CRUD.
- `server/tests/documents.test.ts`, `projects.test.ts`, `triggers.test.ts`, `frontmatter.test.ts`, `spaceFs.test.ts` — **create**.
- `server/tests/db.test.ts` — **modify**: assert new tables exist and legacy ones don't.

**Deleted in Plan 2/3 (listed here so they aren't recreated):** `space_items`, `item_templates`, `artifacts`, `campaigns`, `campaign_tasks`, `pipelines`, `pipeline_tasks`, `space_notes`, `space_files`, `space_documents`, and the services/routes/UI that back them (`services/items.ts`, `services/templates.ts`, `lib/blocks.ts`, `lib/item-schema.ts`, `services/capabilities.ts`, `tools/item_ops.ts`, `web/src/components/BlockRenderer.tsx`). Plan 1 only removes the *tables* and adds the new ones; the dependent code is removed in its own plan to keep each task compiling.

---

## Task 1: Add gray-matter dependency

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install gray-matter**

Run: `cd server && npm install gray-matter@^4.0.3`
Expected: `package.json` gains `"gray-matter": "^4.0.3"` under dependencies; install succeeds.

- [ ] **Step 2: Verify it imports under ESM**

Run: `cd server && node --input-type=module -e "import matter from 'gray-matter'; console.log(typeof matter)"`
Expected: prints `function`

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "build: add gray-matter for document frontmatter parsing"
```

---

## Task 2: Frontmatter parse/serialize helper

**Files:**
- Create: `server/src/lib/frontmatter.ts`
- Test: `server/tests/frontmatter.test.ts`

**Interfaces:**
- Produces:
  - `parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string }`
  - `serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string`

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/frontmatter.test.ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from '../src/lib/frontmatter.js';

describe('frontmatter', () => {
  it('parses YAML frontmatter and body', () => {
    const raw = '---\ntype: application\nstatus: applied\n---\n# Acme\nbody text\n';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({ type: 'application', status: 'applied' });
    expect(body.trim()).toBe('# Acme\nbody text');
  });

  it('returns empty frontmatter when none present', () => {
    const { frontmatter, body } = parseFrontmatter('# Just a heading\n');
    expect(frontmatter).toEqual({});
    expect(body.trim()).toBe('# Just a heading');
  });

  it('round-trips through serialize', () => {
    const out = serializeFrontmatter({ type: 'resume', master: true }, '# Resume\n');
    const { frontmatter, body } = parseFrontmatter(out);
    expect(frontmatter).toEqual({ type: 'resume', master: true });
    expect(body.trim()).toBe('# Resume');
  });

  it('serializes empty frontmatter as plain body', () => {
    expect(serializeFrontmatter({}, '# Hi\n')).toBe('# Hi\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/frontmatter.test.ts`
Expected: FAIL — cannot find module `../src/lib/frontmatter.js`

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/lib/frontmatter.ts
import matter from 'gray-matter';

export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const parsed = matter(raw);
  return { frontmatter: parsed.data as Record<string, unknown>, body: parsed.content };
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  if (Object.keys(frontmatter).length === 0) return body;
  // gray-matter's stringify adds the --- fences and trailing newline.
  return matter.stringify(body, frontmatter);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/frontmatter.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/frontmatter.ts server/tests/frontmatter.test.ts
git commit -m "feat: frontmatter parse/serialize helper"
```

---

## Task 3: Baseline schema — drop legacy, add projects/documents/triggers, widen connections

**Files:**
- Modify: `server/src/db/index.ts` (the bootstrap `CREATE TABLE` block executed by `initDb`)
- Modify: `server/tests/db.test.ts`

**Interfaces:**
- Produces these tables (exact DDL below): `projects`, `documents`, `triggers`; widened `connections`.

This task only changes the **schema definition** and its assertions. Accessor functions come in later tasks. Because the DB is disposable, edit the bootstrap DDL directly and delete a stale local db file if present.

- [ ] **Step 1: Update the schema assertions test (failing first)**

Edit `server/tests/db.test.ts` — in the `creates all tables` test add:

```typescript
    expect(names).toContain('projects');
    expect(names).toContain('documents');
    expect(names).toContain('triggers');
    expect(names).not.toContain('space_items');
    expect(names).not.toContain('item_templates');
    expect(names).not.toContain('artifacts');
    expect(names).not.toContain('pipelines');
    expect(names).not.toContain('pipeline_tasks');
    expect(names).not.toContain('campaign_tasks');
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/db.test.ts`
Expected: FAIL — `projects`/`documents`/`triggers` missing and/or legacy tables still present.

- [ ] **Step 3: Add the new tables to the bootstrap DDL**

In `server/src/db/index.ts`, inside the `initDb()` bootstrap `database.exec(\`...\`)` block (where `users`, `connections`, `spaces`, `sessions`, etc. are created), add these `CREATE TABLE` statements. Place them after the `spaces` table:

```sql
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      default_branch TEXT,
      origin TEXT NOT NULL CHECK(origin IN ('created','linked')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_projects_space ON projects(space_id);

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT,
      status TEXT,
      frontmatter TEXT NOT NULL DEFAULT '{}',
      source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(space_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_documents_space_type ON documents(space_id, type);

    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('schedule','webhook','manual')),
      schedule_cron TEXT,
      playbook_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_triggers_space ON triggers(space_id);
```

- [ ] **Step 4: Widen the `connections.type` CHECK constraint**

In the same bootstrap block, replace the `connections` `CREATE TABLE` `type` CHECK to allow personal-account integrations:

```sql
      type TEXT NOT NULL CHECK(type IN ('anthropic','openai','github','mcp','local','claude_code','codex','oauth','browser')),
```

(Keep the rest of the `connections` definition unchanged.)

- [ ] **Step 5: Remove legacy content/DAG tables from the bootstrap**

Delete the `CREATE TABLE` statements for `space_items`, `item_templates`, `artifacts`, `campaigns`, `campaign_tasks`, `pipelines`, `pipeline_tasks`, `space_notes`, `space_files`, `space_documents`, and any `CREATE INDEX` referencing them, from the bootstrap block. Also remove any post-bootstrap migration in this file whose sole purpose was creating/altering those tables (search for each name).

- [ ] **Step 6: Rename legacy `project_id`-means-space columns to `space_id`**

In the bootstrap DDL, rename `project_id` → `space_id` (and the FK target `projects(id)` → `spaces(id)`, `ON DELETE` behavior unchanged) in: `session_events`, `executions`, `memories`. Rename table `session_project_links` → `session_space_links` with column `space_id REFERENCES spaces(id)`. Leave `agent_worktrees.project_id` as-is but change its FK to `REFERENCES projects(id) ON DELETE CASCADE` (a worktree is per-repo). Update the corresponding `session_events.type` CHECK list values `'project_linked'`/`'project_created'` to `'space_linked'`/`'project_created'` (space-link vs repo-create are now distinct concepts — keep both literals available).

- [ ] **Step 7: Delete any stale local dev database, then run the test**

Run: `cd server && rm -f "$DATA_DIR/app.db" 2>/dev/null; npx vitest run tests/db.test.ts`
Expected: PASS — new tables present, legacy absent.

- [ ] **Step 8: Build to surface references to renamed/removed columns**

Run: `cd server && npx tsc --noEmit`
Expected: Compile errors only in files that read the removed tables/columns (items/templates/capabilities/DAG code). **Do not fix those here** — they are deleted in Plan 2/3. Record the error list in the commit body. If errors appear in files *not* on the Plan 2/3 delete list (e.g. `db/index.ts` accessors referencing renamed columns), fix those now.

- [ ] **Step 9: Commit**

```bash
git add server/src/db/index.ts server/tests/db.test.ts
git commit -m "feat: baseline schema for projects/documents/triggers; drop legacy item/DAG tables

Renamed legacy project_id->space_id on session_events/executions/memories.
Known-broken (deleted in follow-up plans): items, templates, capabilities, pipelines/campaigns."
```

---

## Task 4: Space filesystem layout + document git helpers

**Files:**
- Create: `server/src/lib/spaceFs.ts`
- Test: `server/tests/spaceFs.test.ts`

**Interfaces:**
- Produces:
  - `spaceDir(spaceId: string): string` → `<dataDir>/spaces/<spaceId>`
  - `documentsDir(spaceId: string): string` → `<spaceDir>/documents`
  - `projectsDir(spaceId: string): string` → `<spaceDir>/projects`
  - `ensureDocumentsRepo(spaceId: string): Promise<void>` — mkdir + `git init` (idempotent)
  - `commitDocuments(spaceId: string, message: string): Promise<void>` — `git add -A && git commit` (no-op if nothing staged)
  - `resolveInDocuments(spaceId: string, relPath: string): string` — path-escape-guarded absolute path

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/spaceFs.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { documentsDir, ensureDocumentsRepo, commitDocuments, resolveInDocuments } from '../src/lib/spaceFs.js';

describe('spaceFs', () => {
  beforeAll(() => { fs.mkdirSync(process.env.DATA_DIR!, { recursive: true }); });

  it('initializes a git repo in documents dir', async () => {
    await ensureDocumentsRepo('space-a');
    expect(fs.existsSync(path.join(documentsDir('space-a'), '.git'))).toBe(true);
  });

  it('commits document changes', async () => {
    await ensureDocumentsRepo('space-b');
    fs.writeFileSync(path.join(documentsDir('space-b'), 'note.md'), '# hi\n');
    await commitDocuments('space-b', 'add note');
    const log = await simpleGit(documentsDir('space-b')).log();
    expect(log.total).toBe(1);
    expect(log.latest?.message).toBe('add note');
  });

  it('rejects path escape', () => {
    expect(() => resolveInDocuments('space-a', '../../etc/passwd')).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/spaceFs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// server/src/lib/spaceFs.ts
import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import { getDataDir } from '../db/index.js';

export function spaceDir(spaceId: string): string {
  return path.join(getDataDir(), 'spaces', spaceId);
}
export function documentsDir(spaceId: string): string {
  return path.join(spaceDir(spaceId), 'documents');
}
export function projectsDir(spaceId: string): string {
  return path.join(spaceDir(spaceId), 'projects');
}

export async function ensureDocumentsRepo(spaceId: string): Promise<void> {
  const dir = documentsDir(spaceId);
  await fs.mkdir(dir, { recursive: true });
  const git = simpleGit(dir);
  if (!(await git.checkIsRepo())) {
    await git.init();
    // Identity so commits succeed in headless/CI environments.
    await git.addConfig('user.email', 'agent@localhost');
    await git.addConfig('user.name', 'Agent');
  }
}

export async function commitDocuments(spaceId: string, message: string): Promise<void> {
  const git = simpleGit(documentsDir(spaceId));
  await git.add('-A');
  const status = await git.status();
  if (status.staged.length === 0) return;
  await git.commit(message);
}

export function resolveInDocuments(spaceId: string, relPath: string): string {
  const root = path.resolve(documentsDir(spaceId));
  const resolved = path.resolve(root, relPath || '.');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes documents root');
  }
  return resolved;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run tests/spaceFs.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/spaceFs.ts server/tests/spaceFs.test.ts
git commit -m "feat: space filesystem layout and document git helpers"
```

---

## Task 5: Documents service (disk source of truth + index)

**Files:**
- Create: `server/src/services/documents.ts`
- Test: `server/tests/documents.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter`/`serializeFrontmatter` (Task 2); `documentsDir`/`ensureDocumentsRepo`/`commitDocuments`/`resolveInDocuments` (Task 4); `getDb` (db/index).
- Produces:
  - `interface DocumentRecord { id; space_id; path; title; type: string|null; status: string|null; frontmatter: Record<string, unknown>; source_session_id: string|null; created_at; updated_at; }`
  - `writeDocument(input: { space_id; path; title; frontmatter?; body: string; source_session_id?: string|null }): Promise<DocumentRecord>` — writes file, upserts index row by `(space_id, path)`, commits.
  - `readDocument(id: string): Promise<(DocumentRecord & { body: string }) | undefined>`
  - `listDocuments(space_id: string, filter?: { type?: string; frontmatter?: Record<string, unknown> }): DocumentRecord[]`
  - `patchFrontmatter(id: string, patch: Record<string, unknown>): Promise<DocumentRecord | undefined>` — merge, rewrite file, update index, commit.
  - `deleteDocument(id: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/documents.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { writeDocument, readDocument, listDocuments, patchFrontmatter, deleteDocument } from '../src/services/documents.js';

const SPACE = 'space-docs';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u1','docs@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u1', 'Docs');
});

describe('documents service', () => {
  it('writes a document to disk and indexes frontmatter', async () => {
    const doc = await writeDocument({
      space_id: SPACE, path: 'application-acme.md', title: 'Acme',
      frontmatter: { type: 'application', status: 'applied', company: 'Acme' },
      body: '# Acme\nNotes',
    });
    expect(doc.type).toBe('application');
    expect(doc.status).toBe('applied');
    const back = await readDocument(doc.id);
    expect(back?.body).toContain('# Acme');
    expect(back?.frontmatter.company).toBe('Acme');
  });

  it('filters by type and frontmatter field', async () => {
    await writeDocument({ space_id: SPACE, path: 'resume.md', title: 'Resume', frontmatter: { type: 'resume' }, body: '# Resume' });
    const apps = listDocuments(SPACE, { type: 'application' });
    expect(apps.map(d => d.path)).toContain('application-acme.md');
    expect(apps.map(d => d.path)).not.toContain('resume.md');
    const acme = listDocuments(SPACE, { frontmatter: { company: 'Acme' } });
    expect(acme).toHaveLength(1);
  });

  it('patches frontmatter and reflects in index + file', async () => {
    const [app] = listDocuments(SPACE, { type: 'application' });
    const updated = await patchFrontmatter(app.id, { status: 'interview' });
    expect(updated?.status).toBe('interview');
    const back = await readDocument(app.id);
    expect(back?.frontmatter.status).toBe('interview');
  });

  it('deletes a document', async () => {
    const doc = await writeDocument({ space_id: SPACE, path: 'tmp.md', title: 'Tmp', body: 'x' });
    expect(await deleteDocument(doc.id)).toBe(true);
    expect(await readDocument(doc.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/documents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// server/src/services/documents.ts
import fs from 'fs/promises';
import path from 'path';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { ensureDocumentsRepo, commitDocuments, resolveInDocuments } from '../lib/spaceFs.js';

export interface DocumentRecord {
  id: string;
  space_id: string;
  path: string;
  title: string;
  type: string | null;
  status: string | null;
  frontmatter: Record<string, unknown>;
  source_session_id: string | null;
  created_at: number;
  updated_at: number;
}

interface DocumentRow extends Omit<DocumentRecord, 'frontmatter'> { frontmatter: string; }

function hydrate(row: DocumentRow): DocumentRecord {
  return { ...row, frontmatter: JSON.parse(row.frontmatter) as Record<string, unknown> };
}

function rowByPath(spaceId: string, p: string): DocumentRow | undefined {
  return getDb().prepare('SELECT * FROM documents WHERE space_id = ? AND path = ?').get(spaceId, p) as DocumentRow | undefined;
}

export async function writeDocument(input: {
  space_id: string;
  path: string;
  title: string;
  frontmatter?: Record<string, unknown>;
  body: string;
  source_session_id?: string | null;
}): Promise<DocumentRecord> {
  await ensureDocumentsRepo(input.space_id);
  const frontmatter = input.frontmatter ?? {};
  const abs = resolveInDocuments(input.space_id, input.path);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, serializeFrontmatter(frontmatter, input.body), 'utf-8');

  const now = Math.floor(Date.now() / 1000);
  const type = (frontmatter.type as string | undefined) ?? null;
  const status = (frontmatter.status as string | undefined) ?? null;
  const existing = rowByPath(input.space_id, input.path);
  const id = existing?.id ?? newId();

  if (existing) {
    getDb().prepare(
      'UPDATE documents SET title=?, type=?, status=?, frontmatter=?, updated_at=? WHERE id=?',
    ).run(input.title, type, status, JSON.stringify(frontmatter), now, id);
  } else {
    getDb().prepare(
      'INSERT INTO documents (id,space_id,path,title,type,status,frontmatter,source_session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.space_id, input.path, input.title, type, status, JSON.stringify(frontmatter), input.source_session_id ?? null, now, now);
  }
  await commitDocuments(input.space_id, `${existing ? 'update' : 'create'} ${input.path}`);
  return hydrate(rowByPath(input.space_id, input.path)!);
}

export async function readDocument(id: string): Promise<(DocumentRecord & { body: string }) | undefined> {
  const row = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
  if (!row) return undefined;
  const raw = await fs.readFile(resolveInDocuments(row.space_id, row.path), 'utf-8');
  return { ...hydrate(row), body: parseFrontmatter(raw).body };
}

export function listDocuments(
  spaceId: string,
  filter?: { type?: string; frontmatter?: Record<string, unknown> },
): DocumentRecord[] {
  const params: unknown[] = [spaceId];
  let sql = 'SELECT * FROM documents WHERE space_id = ?';
  if (filter?.type) { sql += ' AND type = ?'; params.push(filter.type); }
  if (filter?.frontmatter) {
    for (const [k, v] of Object.entries(filter.frontmatter)) {
      sql += ` AND json_extract(frontmatter, '$.${k}') = ?`;
      params.push(v);
    }
  }
  sql += ' ORDER BY updated_at DESC, id DESC';
  return (getDb().prepare(sql).all(...params) as DocumentRow[]).map(hydrate);
}

export async function patchFrontmatter(id: string, patch: Record<string, unknown>): Promise<DocumentRecord | undefined> {
  const current = await readDocument(id);
  if (!current) return undefined;
  const merged = { ...current.frontmatter, ...patch };
  return writeDocument({
    space_id: current.space_id,
    path: current.path,
    title: current.title,
    frontmatter: merged,
    body: current.body,
    source_session_id: current.source_session_id,
  });
}

export async function deleteDocument(id: string): Promise<boolean> {
  const row = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
  if (!row) return false;
  try { await fs.unlink(resolveInDocuments(row.space_id, row.path)); } catch { /* already gone */ }
  getDb().prepare('DELETE FROM documents WHERE id = ?').run(id);
  await commitDocuments(row.space_id, `delete ${row.path}`);
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run tests/documents.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/documents.ts server/tests/documents.test.ts
git commit -m "feat: documents service backed by filesystem + frontmatter index"
```

---

## Task 6: Projects service (repo create/link + index)

**Files:**
- Create: `server/src/services/projects.ts`
- Test: `server/tests/projects.test.ts`

**Interfaces:**
- Consumes: `projectsDir` (Task 4); `getDb`, `newId`.
- Produces:
  - `interface ProjectRecord { id; space_id; name; repo_path; default_branch: string|null; origin: 'created'|'linked'; created_at; }`
  - `createProject(input: { space_id; name }): Promise<ProjectRecord>` — mkdir `<projectsDir>/<id>`, `git init`, index row with `origin:'created'`.
  - `linkProject(input: { space_id; name; repo_path; default_branch?: string|null }): ProjectRecord` — index an existing absolute path with `origin:'linked'`.
  - `listProjects(space_id: string): ProjectRecord[]`
  - `getProject(id: string): ProjectRecord | undefined`
  - `deleteProject(id: string): boolean` — index row only (does not delete disk for linked; created repos left on disk, mirroring current repo-item behavior).

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/projects.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb } from '../src/db/index.js';
import { createProject, linkProject, listProjects, getProject, deleteProject } from '../src/services/projects.js';

const SPACE = 'space-proj';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u2','proj@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u2', 'Proj');
});

describe('projects service', () => {
  it('creates a repo on disk and indexes it', async () => {
    const proj = await createProject({ space_id: SPACE, name: 'Yuzic' });
    expect(proj.origin).toBe('created');
    expect(fs.existsSync(path.join(proj.repo_path, '.git'))).toBe(true);
    expect(listProjects(SPACE).map(p => p.id)).toContain(proj.id);
  });

  it('links an external repo path', () => {
    const proj = linkProject({ space_id: SPACE, name: 'External', repo_path: '/tmp/some/repo', default_branch: 'main' });
    expect(proj.origin).toBe('linked');
    expect(getProject(proj.id)?.repo_path).toBe('/tmp/some/repo');
  });

  it('deletes the index row', () => {
    const proj = linkProject({ space_id: SPACE, name: 'Gone', repo_path: '/tmp/gone' });
    expect(deleteProject(proj.id)).toBe(true);
    expect(getProject(proj.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/projects.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// server/src/services/projects.ts
import fs from 'fs/promises';
import path from 'path';
import simpleGit from 'simple-git';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { projectsDir } from '../lib/spaceFs.js';

export interface ProjectRecord {
  id: string;
  space_id: string;
  name: string;
  repo_path: string;
  default_branch: string | null;
  origin: 'created' | 'linked';
  created_at: number;
}

function insert(rec: ProjectRecord): void {
  getDb().prepare(
    'INSERT INTO projects (id,space_id,name,repo_path,default_branch,origin,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(rec.id, rec.space_id, rec.name, rec.repo_path, rec.default_branch, rec.origin, rec.created_at);
}

export async function createProject(input: { space_id: string; name: string }): Promise<ProjectRecord> {
  const id = newId();
  const repoPath = path.join(projectsDir(input.space_id), id);
  await fs.mkdir(repoPath, { recursive: true });
  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.email', 'agent@localhost');
  await git.addConfig('user.name', 'Agent');
  const rec: ProjectRecord = {
    id, space_id: input.space_id, name: input.name, repo_path: repoPath,
    default_branch: null, origin: 'created', created_at: Math.floor(Date.now() / 1000),
  };
  insert(rec);
  return rec;
}

export function linkProject(input: { space_id: string; name: string; repo_path: string; default_branch?: string | null }): ProjectRecord {
  const rec: ProjectRecord = {
    id: newId(), space_id: input.space_id, name: input.name, repo_path: input.repo_path,
    default_branch: input.default_branch ?? null, origin: 'linked', created_at: Math.floor(Date.now() / 1000),
  };
  insert(rec);
  return rec;
}

export function listProjects(spaceId: string): ProjectRecord[] {
  return getDb().prepare('SELECT * FROM projects WHERE space_id = ? ORDER BY created_at DESC').all(spaceId) as ProjectRecord[];
}

export function getProject(id: string): ProjectRecord | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRecord | undefined;
}

export function deleteProject(id: string): boolean {
  return getDb().prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run tests/projects.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/projects.ts server/tests/projects.test.ts
git commit -m "feat: projects service (create/link git repos per space)"
```

---

## Task 7: Triggers service

**Files:**
- Create: `server/src/services/triggers.ts`
- Test: `server/tests/triggers.test.ts`

**Interfaces:**
- Consumes: `getDb`, `newId`.
- Produces:
  - `interface TriggerRecord { id; space_id; kind: 'schedule'|'webhook'|'manual'; schedule_cron: string|null; playbook_id: string|null; enabled: number; next_run_at: number|null; last_run_at: number|null; created_at; }`
  - `createTrigger(input: { space_id; kind; schedule_cron?: string|null; playbook_id?: string|null; next_run_at?: number|null }): TriggerRecord`
  - `listTriggers(space_id: string): TriggerRecord[]`
  - `setTriggerEnabled(id: string, enabled: boolean): boolean`
  - `markTriggerRun(id: string, next_run_at: number | null): void`
  - `deleteTrigger(id: string): boolean`

Note: this service is the storage primitive only. The runner that fires triggers and starts sessions is **Plan 2**. The legacy `scheduled_tasks` table and `services/scheduled_tasks.ts` are *not used* by this; they are removed in Plan 2 once the runner replaces them.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/triggers.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { createTrigger, listTriggers, setTriggerEnabled, markTriggerRun, deleteTrigger } from '../src/services/triggers.js';

const SPACE = 'space-trig';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u3','trig@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u3', 'Trig');
});

describe('triggers service', () => {
  it('creates and lists triggers', () => {
    const t = createTrigger({ space_id: SPACE, kind: 'schedule', schedule_cron: '0 8 * * *', next_run_at: 1000 });
    expect(t.kind).toBe('schedule');
    expect(listTriggers(SPACE).map(x => x.id)).toContain(t.id);
  });

  it('toggles enabled and records a run', () => {
    const [t] = listTriggers(SPACE);
    expect(setTriggerEnabled(t.id, false)).toBe(true);
    markTriggerRun(t.id, 2000);
    const updated = listTriggers(SPACE).find(x => x.id === t.id)!;
    expect(updated.enabled).toBe(0);
    expect(updated.next_run_at).toBe(2000);
    expect(updated.last_run_at).not.toBeNull();
  });

  it('deletes a trigger', () => {
    const t = createTrigger({ space_id: SPACE, kind: 'manual' });
    expect(deleteTrigger(t.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/triggers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// server/src/services/triggers.ts
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export interface TriggerRecord {
  id: string;
  space_id: string;
  kind: 'schedule' | 'webhook' | 'manual';
  schedule_cron: string | null;
  playbook_id: string | null;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
}

export function createTrigger(input: {
  space_id: string;
  kind: 'schedule' | 'webhook' | 'manual';
  schedule_cron?: string | null;
  playbook_id?: string | null;
  next_run_at?: number | null;
}): TriggerRecord {
  const rec: TriggerRecord = {
    id: newId(), space_id: input.space_id, kind: input.kind,
    schedule_cron: input.schedule_cron ?? null, playbook_id: input.playbook_id ?? null,
    enabled: 1, next_run_at: input.next_run_at ?? null, last_run_at: null,
    created_at: Math.floor(Date.now() / 1000),
  };
  getDb().prepare(
    'INSERT INTO triggers (id,space_id,kind,schedule_cron,playbook_id,enabled,next_run_at,last_run_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(rec.id, rec.space_id, rec.kind, rec.schedule_cron, rec.playbook_id, rec.enabled, rec.next_run_at, rec.last_run_at, rec.created_at);
  return rec;
}

export function listTriggers(spaceId: string): TriggerRecord[] {
  return getDb().prepare('SELECT * FROM triggers WHERE space_id = ? ORDER BY created_at DESC').all(spaceId) as TriggerRecord[];
}

export function setTriggerEnabled(id: string, enabled: boolean): boolean {
  return getDb().prepare('UPDATE triggers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes > 0;
}

export function markTriggerRun(id: string, nextRunAt: number | null): void {
  getDb().prepare('UPDATE triggers SET last_run_at = unixepoch(), next_run_at = ? WHERE id = ?').run(nextRunAt, id);
}

export function deleteTrigger(id: string): boolean {
  return getDb().prepare('DELETE FROM triggers WHERE id = ?').run(id).changes > 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run tests/triggers.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/triggers.ts server/tests/triggers.test.ts
git commit -m "feat: triggers service (schedule/webhook/manual storage primitive)"
```

---

## Self-Review

- **Spec coverage:** Projects table + service (Tasks 3, 6) ✓; Documents table + frontmatter index + git (Tasks 2, 3, 4, 5) ✓; Triggers table + service (Tasks 3, 7) ✓; connections widened for personal accounts (Task 3, Step 4) ✓; proper-names rename of legacy `project_id` (Task 3, Step 6) ✓; legacy item/DAG/blocks tables dropped (Task 3, Step 5) ✓. The **trigger runner**, **agent tools**, **HTTP routes**, and **web UI** are intentionally out of scope → Plans 2 and 3.
- **Placeholder scan:** No TBDs; every code step has full code; every run step has expected output.
- **Type consistency:** `DocumentRecord`, `ProjectRecord`, `TriggerRecord` field names match between interface blocks, SQL columns, and tests. `writeDocument`/`patchFrontmatter` share the same shape. `origin` values `'created'|'linked'` match the CHECK constraint in Task 3.

---

## Roadmap — subsequent plans (not implemented here)

**Plan 2 — Agent tools + the n8n loop (backend).**
- Delete dead code: `services/items.ts`, `services/templates.ts`, `lib/blocks.ts`, `lib/item-schema.ts`, `services/capabilities.ts`, `services/projectCapabilities.ts` (as item-coupled), `tools/item_ops.ts`, and the DAG services. Fix all compile errors surfaced in Task 3 Step 8.
- New agent tools over the Task 5–7 services: `write_document`, `read_document`, `list_documents`, `patch_frontmatter`, `create_project`, `link_project`, `create_trigger`, `list_triggers`.
- **Trigger runner**: a scheduler that wakes on `triggers.next_run_at`, starts a session pinned to the space with the playbook document (`type: workflow`) as the prompt, computes the next cron time, calls `markTriggerRun`. Replaces `services/scheduled_tasks.ts`; drop the `scheduled_tasks` table.
- HTTP routes: rewrite `routes/spaces.ts` item endpoints into `/spaces/:id/documents`, `/spaces/:id/projects`, `/spaces/:id/triggers`; keep repo file-browsing endpoints repointed at `projects`.

**Plan 3 — Web UI.**
- Rebuild `SpacePage.tsx` tabs around Projects + Documents + Triggers + Chats.
- Markdown editor/reader for documents (replace `BlockRenderer`); delete `BlockRenderer.tsx` and block types from `types.ts`.
- Tracker view = `list_documents(type=...)` grouped by `status` (a saved query over frontmatter).
- Triggers management UI; connections-per-space already exists in Settings.
```
