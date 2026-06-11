# Memory Rework: Typed Memory + Scheduled Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat key-value `user_memory` table with a typed `memories` store (`user`/`feedback`/`project`/`reference`) curated via `remember`/`recall`/`forget` tools, and add a generic `scheduled_tasks` system whose first job (`reorganize_memory`) runs daily as a normal visible session.

**Architecture:** Clean DB rebuild (drop `user_memory`, add `memories` + `scheduled_tasks`, migrate old rows as `type='user'`). Rewrite `services/memory.ts` and `tools/memory_tools.ts` for the typed model, add a `forget` tool, and wire formatted output into `agent.ts`'s system prompt. New `services/scheduled_tasks.ts` (run dispatcher) + `routes/scheduled_tasks.ts` (CRUD/run API) + `services/scheduler.ts` (in-process interval poller). Frontend gets typed `Memory`/`ScheduledTask` types, API helpers, and a reworked Settings page (grouped memory display + scheduled tasks section).

**Tech Stack:** Node/TypeScript/Express, better-sqlite3, Vitest + Supertest, React/Vite, TanStack Query, daisyUI/shadcn components.

---

## Task 1: DB schema — `memories` and `scheduled_tasks`

**Files:**
- Modify: `server/src/db/index.ts`
- Modify: `server/tests/db.test.ts`

- [ ] **Step 1: Update the failing test expectations**

In `server/tests/db.test.ts`, replace:

```ts
    expect(names).toContain('user_memory');
```

with:

```ts
    expect(names).toContain('memories');
    expect(names).toContain('scheduled_tasks');
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd server && npx vitest run tests/db.test.ts`
Expected: FAIL — `names` does not contain `'memories'`/`'scheduled_tasks'` (table not yet created).

- [ ] **Step 3: Replace the `user_memory` table definition with `memories` + `scheduled_tasks`**

In `server/src/db/index.ts`, inside the `applySchema()` template string, replace:

```sql
    CREATE TABLE IF NOT EXISTS user_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, key)
    );
```

with:

```sql
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('user','feedback','project','reference')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, type, key)
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      interval_hours INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER NOT NULL,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
```

- [ ] **Step 4: Add the `user_memory` → `memories` migration**

In `server/src/db/index.ts`, immediately after the existing `workspaces` migration block (right before the closing `}` of the function, after `db.exec('DROP TABLE workspaces');` and its enclosing `if`), add:

```ts
  if (tableNames.some(t => t.name === 'user_memory')) {
    db.exec(`
      INSERT INTO memories (id, user_id, type, key, value, created_at, updated_at)
      SELECT id, user_id, 'user', key, value, created_at, updated_at FROM user_memory
      WHERE NOT EXISTS (SELECT 1 FROM memories WHERE memories.id = user_memory.id);

      DROP TABLE user_memory;
    `);
  }
```

- [ ] **Step 5: Add `newId` import and `scheduled_tasks` helper functions**

In `server/src/db/index.ts`, add the import at the top (after the existing `fs` import):

```ts
import { newId } from '../lib/ids.js';
```

At the end of the file, after `setProjectsRoot`, add:

```ts
export interface DbScheduledTask {
  id: string;
  type: string;
  interval_hours: number;
  enabled: number;
  next_run_at: number;
  last_run_at: number | null;
}

export function getScheduledTasksForUser(userId: string): DbScheduledTask[] {
  return getDb()
    .prepare('SELECT id, type, interval_hours, enabled, next_run_at, last_run_at FROM scheduled_tasks WHERE user_id = ?')
    .all(userId) as DbScheduledTask[];
}

export function getScheduledTaskForUser(id: string, userId: string): DbScheduledTask | undefined {
  return getDb()
    .prepare('SELECT id, type, interval_hours, enabled, next_run_at, last_run_at FROM scheduled_tasks WHERE id = ? AND user_id = ?')
    .get(id, userId) as DbScheduledTask | undefined;
}

export function updateScheduledTask(id: string, userId: string, updates: { enabled?: boolean; interval_hours?: number }): void {
  if (updates.enabled !== undefined) {
    getDb().prepare('UPDATE scheduled_tasks SET enabled = ? WHERE id = ? AND user_id = ?').run(updates.enabled ? 1 : 0, id, userId);
  }
  if (updates.interval_hours !== undefined) {
    getDb().prepare('UPDATE scheduled_tasks SET interval_hours = ? WHERE id = ? AND user_id = ?').run(updates.interval_hours, id, userId);
  }
}

export function createScheduledTask(userId: string, type: string, intervalHours: number): string {
  const id = newId();
  const nextRunAt = Math.floor(Date.now() / 1000) + intervalHours * 3600;
  getDb()
    .prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, next_run_at) VALUES (?,?,?,?,?)')
    .run(id, userId, type, intervalHours, nextRunAt);
  return id;
}

export function getDueScheduledTasks(now: number): (DbScheduledTask & { user_id: string })[] {
  return getDb()
    .prepare('SELECT id, user_id, type, interval_hours, enabled, next_run_at, last_run_at FROM scheduled_tasks WHERE enabled = 1 AND next_run_at <= ?')
    .all(now) as (DbScheduledTask & { user_id: string })[];
}

export function markScheduledTaskRun(id: string, now: number, intervalHours: number): void {
  getDb()
    .prepare('UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?')
    .run(now, now + intervalHours * 3600, id);
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `cd server && npx vitest run tests/db.test.ts`
Expected: PASS (all tests in `db.test.ts`)

- [ ] **Step 7: Commit**

```bash
cd server && git add src/db/index.ts tests/db.test.ts
git commit -m "feat: replace user_memory with typed memories and scheduled_tasks tables"
```

---

## Task 2: Typed memory service, tools, and tool definitions

**Files:**
- Modify: `server/src/services/memory.ts`
- Modify: `server/src/tools/memory_tools.ts`
- Modify: `server/src/tools/definitions.ts`
- Modify: `server/tests/services/memory.test.ts`
- Create: `server/tests/tools/memory_tools.test.ts`

- [ ] **Step 1: Rewrite `server/tests/services/memory.test.ts` with typed-API tests**

Replace the entire file with:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { rememberFact, recallFact, forgetFact, recallAll, projectNameFor } from '../../src/services/memory.js';
import { newId } from '../../src/lib/ids.js';

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `mem-${userId}@test.com`, 'x');
});

describe('memory', () => {
  it('stores and recalls a fact', () => {
    rememberFact(userId, 'user', 'preferred_model', 'claude-opus-4-8');
    expect(recallFact(userId, 'user', 'preferred_model')).toBe('claude-opus-4-8');
  });

  it('updates an existing key', () => {
    rememberFact(userId, 'user', 'preferred_model', 'claude-sonnet-4-6');
    expect(recallFact(userId, 'user', 'preferred_model')).toBe('claude-sonnet-4-6');
  });

  it('returns null for missing key', () => {
    expect(recallFact(userId, 'user', 'nonexistent')).toBeNull();
  });

  it('keeps separate values per type for the same key', () => {
    rememberFact(userId, 'user', 'shared_key', 'user-value');
    rememberFact(userId, 'feedback', 'shared_key', 'feedback-value');
    expect(recallFact(userId, 'user', 'shared_key')).toBe('user-value');
    expect(recallFact(userId, 'feedback', 'shared_key')).toBe('feedback-value');
  });

  it('returns all entries for a user, optionally filtered by type', () => {
    rememberFact(userId, 'reference', 'bug_tracker', 'Linear project INGEST');
    const all = recallAll(userId);
    expect(all.some(e => e.type === 'user' && e.key === 'preferred_model')).toBe(true);
    expect(all.some(e => e.type === 'feedback' && e.key === 'shared_key')).toBe(true);
    expect(all.some(e => e.type === 'reference' && e.key === 'bug_tracker')).toBe(true);

    const onlyFeedback = recallAll(userId, 'feedback');
    expect(onlyFeedback.every(e => e.type === 'feedback')).toBe(true);
    expect(onlyFeedback.some(e => e.key === 'shared_key')).toBe(true);
  });

  it('forgets a fact', () => {
    rememberFact(userId, 'user', 'temp_fact', 'temporary');
    expect(forgetFact(userId, 'user', 'temp_fact')).toBe(true);
    expect(recallFact(userId, 'user', 'temp_fact')).toBeNull();
    expect(forgetFact(userId, 'user', 'temp_fact')).toBe(false);
  });

  it('stores project-linked entries with a project_id', () => {
    const projectId = newId();
    getDb().prepare('INSERT INTO projects (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)')
      .run(projectId, userId, 'demo-project', '[]');

    rememberFact(userId, 'project', 'auth_status', 'blocked on legal review', projectId);
    const all = recallAll(userId, 'project');
    const entry = all.find(e => e.key === 'auth_status');
    expect(entry?.project_id).toBe(projectId);
    expect(projectNameFor(userId, projectId)).toBe('demo-project');
  });

  it('projectNameFor returns null for null project_id', () => {
    expect(projectNameFor(userId, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd server && npx vitest run tests/services/memory.test.ts`
Expected: FAIL — `rememberFact`/`recallFact`/etc. don't accept a `type` argument yet.

- [ ] **Step 3: Rewrite `server/src/services/memory.ts`**

Replace the entire file with:

```ts
import { getDb, getProjectForUser } from '../db/index.js';
import { newId } from '../lib/ids.js';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  type: MemoryType;
  key: string;
  value: string;
  project_id: string | null;
}

export function rememberFact(userId: string, type: MemoryType, key: string, value: string, projectId: string | null = null): void {
  const existing = getDb()
    .prepare('SELECT id FROM memories WHERE user_id = ? AND type = ? AND key = ?')
    .get(userId, type, key);
  if (existing) {
    getDb()
      .prepare('UPDATE memories SET value = ?, project_id = ?, updated_at = unixepoch() WHERE user_id = ? AND type = ? AND key = ?')
      .run(value, projectId, userId, type, key);
  } else {
    getDb()
      .prepare('INSERT INTO memories (id, user_id, type, key, value, project_id) VALUES (?,?,?,?,?,?)')
      .run(newId(), userId, type, key, value, projectId);
  }
}

export function recallFact(userId: string, type: MemoryType, key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM memories WHERE user_id = ? AND type = ? AND key = ?')
    .get(userId, type, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function forgetFact(userId: string, type: MemoryType, key: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM memories WHERE user_id = ? AND type = ? AND key = ?')
    .run(userId, type, key);
  return result.changes > 0;
}

export function recallAll(userId: string, type?: MemoryType): MemoryEntry[] {
  const rows = type
    ? getDb().prepare('SELECT type, key, value, project_id FROM memories WHERE user_id = ? AND type = ?').all(userId, type)
    : getDb().prepare('SELECT type, key, value, project_id FROM memories WHERE user_id = ?').all(userId);
  return rows as MemoryEntry[];
}

export function projectNameFor(userId: string, projectId: string | null): string | null {
  if (!projectId) return null;
  return getProjectForUser(projectId, userId)?.name ?? null;
}
```

- [ ] **Step 4: Run memory service tests to verify pass**

Run: `cd server && npx vitest run tests/services/memory.test.ts`
Expected: PASS (all tests in `memory.test.ts`)

- [ ] **Step 5: Write `server/tests/tools/memory_tools.test.ts`**

Create the file:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { remember, recall, forget } from '../../src/tools/memory_tools.js';
import { newId } from '../../src/lib/ids.js';

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `memtools-${userId}@test.com`, 'x');
});

describe('memory_tools', () => {
  it('remember stores a typed entry and recall reads it back', () => {
    const result = remember(userId, 'user', 'timezone', 'PST');
    expect(result).toBe('Remembered [user] timezone: PST');
    expect(recall(userId, 'user', 'timezone')).toBe('[user] timezone: PST');
  });

  it('remember rejects an invalid type', () => {
    const result = remember(userId, 'bogus', 'key', 'value');
    expect(result).toContain('invalid memory type');
  });

  it('recall with no args returns all entries grouped by type', () => {
    remember(userId, 'feedback', 'package_manager', 'use pnpm, not npm');
    const result = recall(userId);
    expect(result).toContain('[user] timezone: PST');
    expect(result).toContain('[feedback] package_manager: use pnpm, not npm');
  });

  it('recall with only type filters by category', () => {
    const result = recall(userId, 'feedback');
    expect(result).toContain('[feedback] package_manager: use pnpm, not npm');
    expect(result).not.toContain('[user] timezone');
  });

  it('recall for a missing key reports no memory', () => {
    expect(recall(userId, 'user', 'nonexistent')).toBe('No memory for [user] nonexistent');
  });

  it('recall with no entries reports the empty state', () => {
    const emptyUserId = newId();
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(emptyUserId, `memtools-empty-${emptyUserId}@test.com`, 'x');
    expect(recall(emptyUserId)).toBe('No memories stored yet.');
  });

  it('forget removes an entry', () => {
    remember(userId, 'user', 'temp', 'value');
    expect(forget(userId, 'user', 'temp')).toBe('Forgot [user] temp');
    expect(recall(userId, 'user', 'temp')).toBe('No memory for [user] temp');
  });

  it('forget on a missing entry reports no memory', () => {
    expect(forget(userId, 'user', 'never_existed')).toBe('No memory for [user] never_existed');
  });

  it('formats project entries with the linked project name', () => {
    const projectId = newId();
    getDb().prepare('INSERT INTO projects (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)')
      .run(projectId, userId, 'demo-project', '[]');
    remember(userId, 'project', 'status', 'in progress', projectId);
    expect(recall(userId, 'project', 'status')).toBe('[project: demo-project] status: in progress');
  });
});
```

- [ ] **Step 6: Run new tool tests to verify failure**

Run: `cd server && npx vitest run tests/tools/memory_tools.test.ts`
Expected: FAIL — `memory_tools.ts` still has the old 2-arg `remember`/`recall` signatures and no `forget`.

- [ ] **Step 7: Rewrite `server/src/tools/memory_tools.ts`**

Replace the entire file with:

```ts
import { rememberFact, recallFact, forgetFact, recallAll, projectNameFor, type MemoryType } from '../services/memory.js';

const TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference'];

function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (TYPES as string[]).includes(value);
}

export function remember(userId: string, type: string, key: string, value: string, projectId?: string): string {
  if (!isMemoryType(type)) return `Error: invalid memory type '${type}'. Must be one of: ${TYPES.join(', ')}`;
  rememberFact(userId, type, key, value, projectId ?? null);
  return `Remembered [${type}] ${key}: ${value}`;
}

export function recall(userId: string, type?: string, key?: string): string {
  if (type !== undefined && !isMemoryType(type)) return `Error: invalid memory type '${type}'. Must be one of: ${TYPES.join(', ')}`;

  if (type && key) {
    const value = recallFact(userId, type, key);
    return value ? `[${type}] ${key}: ${value}` : `No memory for [${type}] ${key}`;
  }

  const entries = recallAll(userId, type as MemoryType | undefined);
  if (entries.length === 0) return 'No memories stored yet.';
  return entries
    .map(e => {
      const label = e.type === 'project'
        ? `[project: ${projectNameFor(userId, e.project_id) ?? e.project_id}]`
        : `[${e.type}]`;
      return `${label} ${e.key}: ${e.value}`;
    })
    .join('\n');
}

export function forget(userId: string, type: string, key: string): string {
  if (!isMemoryType(type)) return `Error: invalid memory type '${type}'. Must be one of: ${TYPES.join(', ')}`;
  const removed = forgetFact(userId, type, key);
  return removed ? `Forgot [${type}] ${key}` : `No memory for [${type}] ${key}`;
}
```

- [ ] **Step 8: Run new tool tests to verify pass**

Run: `cd server && npx vitest run tests/tools/memory_tools.test.ts`
Expected: PASS (all tests in `memory_tools.test.ts`)

- [ ] **Step 9: Update `server/src/tools/definitions.ts`**

Replace the existing `remember` and `recall` tool definitions:

```typescript
  {
    name: 'remember',
    description: 'Store a fact about the user for future sessions.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short identifier for the fact' },
        value: { type: 'string', description: 'The fact to remember' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'recall',
    description: 'Read stored facts about the user. Pass a key to get one fact, or omit key to get all.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to look up (optional — omit to get all)' },
      },
    },
  },
```

with:

```typescript
  {
    name: 'remember',
    description: "Store or update a memory entry. Use 'user' for durable facts/preferences about the user or their environment, 'feedback' for corrections or process preferences about how you should work, 'project' for notes tied to a specific project (pass project_id), and 'reference' for pointers to external systems.",
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'], description: 'Category of memory' },
        key: { type: 'string', description: 'Short identifier for the entry' },
        value: { type: 'string', description: 'The fact or note to remember' },
        project_id: { type: 'string', description: "Required when type is 'project' — the project this note relates to" },
      },
      required: ['type', 'key', 'value'],
    },
  },
  {
    name: 'recall',
    description: 'Read stored memory entries. Omit type and key to get everything (grouped by type). Pass type to filter by category, and type+key to get a single entry.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'], description: 'Category to filter by (optional)' },
        key: { type: 'string', description: 'Key to look up (optional — requires type)' },
      },
    },
  },
  {
    name: 'forget',
    description: 'Delete a memory entry by type and key.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
        key: { type: 'string' },
      },
      required: ['type', 'key'],
    },
  },
```

- [ ] **Step 10: Run full server test suite to verify nothing else broke yet**

Run: `cd server && npx vitest run`
Expected: `tests/services/agent.test.ts`, `tests/memory-route.test.ts` FAIL (they use the old API — fixed in Task 3). All other suites PASS.

- [ ] **Step 11: Commit**

```bash
cd server && git add src/services/memory.ts src/tools/memory_tools.ts src/tools/definitions.ts tests/services/memory.test.ts tests/tools/memory_tools.test.ts
git commit -m "feat: typed memory service and remember/recall/forget tools"
```

---

## Task 3: Wire typed memory into the agent and memory route

**Files:**
- Modify: `server/src/services/agent.ts`
- Modify: `server/tests/services/agent.test.ts`
- Modify: `server/tests/memory-route.test.ts`
- (No code change to `server/src/routes/memory.ts` — response shape changes automatically via `recallAll`'s new return type)

- [ ] **Step 1: Rewrite `server/tests/memory-route.test.ts`**

Replace the entire file with:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';
import { rememberFact } from '../src/services/memory.js';

let token: string;
let userId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `mem-route-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
  // Decode userId from JWT payload (middle segment)
  const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64').toString());
  userId = payload.userId;
  rememberFact(userId, 'user', 'preferred_language', 'TypeScript');
  rememberFact(userId, 'feedback', 'package_manager', 'use pnpm, not npm');
});

describe('GET /memory', () => {
  it('returns all memory entries for the user', async () => {
    const res = await request(app)
      .get('/memory')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toContainEqual({ type: 'user', key: 'preferred_language', value: 'TypeScript', project_id: null });
    expect(res.body).toContainEqual({ type: 'feedback', key: 'package_manager', value: 'use pnpm, not npm', project_id: null });
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/memory');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run memory-route test to verify failure**

Run: `cd server && npx vitest run tests/memory-route.test.ts`
Expected: FAIL — `rememberFact(userId, 'user', ...)` 4-arg call doesn't match current still-2-arg... actually `memory.ts` was already rewritten in Task 2, so this should now compile. The failure (if any) would be a type mismatch in the response shape vs old expectations — but we already updated the assertions, so this test should now pass once `memory.ts` from Task 2 is in place. Run it to confirm:

Expected: PASS (this test only depends on Task 2's `memory.ts`, already done — this step is a confirmation, not a TDD red step)

- [ ] **Step 3: Add memory-related tests to `server/tests/services/agent.test.ts`**

Add the following two `it` blocks inside the `describe('agent', ...)` block, after the existing `'returns "no repo" error for invoke_claude_code...'` test (i.e., as the new last tests in the file, before the closing `});` of the describe block):

```ts
  it('renders "No memories stored yet." in the system prompt when memory is empty', async () => {
    const db = getDb();
    const freshUserId = newId();
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(freshUserId, `agent-fresh-${freshUserId}@test.com`, 'x');
    const { encrypt, deriveKey } = await import('../../src/lib/crypto.js');
    db.prepare('INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)')
      .run(newId(), freshUserId, 'main', 'anthropic', encrypt(JSON.stringify({ apiKey: 'sk-test' }), deriveKey()));

    const freshSessionId = newId();
    db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(freshSessionId, freshUserId);
    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, freshSessionId, 'user', 'hi');

    streamMock.mockClear();
    await runAgentTurn(freshUserId, freshSessionId, msgId);

    const call = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    expect(call.system).toContain('User memory:\nNo memories stored yet.');
  });

  it('renders typed and project-linked memory entries in the system prompt', async () => {
    const db = getDb();
    const { rememberFact } = await import('../../src/services/memory.js');

    const projectId = newId();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'demo', 'Demo project', null, '[]');

    rememberFact(userId, 'feedback', 'package_manager', 'use pnpm, not npm');
    rememberFact(userId, 'project', 'status', 'auth refactor blocked on legal review', projectId);

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'hi');

    streamMock.mockClear();
    await runAgentTurn(userId, sessionId, msgId);

    const call = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    expect(call.system).toContain('- [feedback] package_manager: use pnpm, not npm');
    expect(call.system).toContain('- [project: demo] status: auth refactor blocked on legal review');
  });

  it('dispatches the forget tool', async () => {
    const { rememberFact, recallFact } = await import('../../src/services/memory.js');
    rememberFact(userId, 'user', 'scratch_note', 'temporary');

    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => ({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tool-3', name: 'forget', input: { type: 'user', key: 'scratch_note' } }],
        }),
      };
    });
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'done' }],
          };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'forget the scratch note');

    await runAgentTurn(userId, sessionId, msgId);

    expect(recallFact(userId, 'user', 'scratch_note')).toBeNull();

    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = (toolResultMsg.content as { content: string }[])[0].content;
    expect(toolResult).toBe('Forgot [user] scratch_note');
  });
```

(The `db` variable used in the new tests is already in scope as `getDb()` — but note the existing tests declare `const db = getDb();` locally inside each `it`. Follow that same pattern: declare `const db = getDb();` at the top of each new test that needs it, as shown above.)

- [ ] **Step 4: Run agent tests to verify failure**

Run: `cd server && npx vitest run tests/services/agent.test.ts`
Expected: FAIL — `buildSystemPrompt` still renders the old `Record<string,string>` format (`- key: value`, no `User memory:\nNo memories stored yet.` empty state, no `[feedback]`/`[project: ...]` labels), and `forget` is an unhandled tool (`Unknown tool: forget`).

- [ ] **Step 5: Update `server/src/services/agent.ts` imports**

Replace:

```ts
import { recallAll } from './memory.js';
```

with:

```ts
import { recallAll, projectNameFor, type MemoryEntry } from './memory.js';
```

Replace:

```ts
import { remember, recall } from '../tools/memory_tools.js';
```

with:

```ts
import { remember, recall, forget } from '../tools/memory_tools.js';
```

- [ ] **Step 6: Add `formatMemoryEntry` helper and update `buildSystemPrompt`**

Add this function above `buildSystemPrompt`:

```ts
function formatMemoryEntry(userId: string, e: MemoryEntry): string {
  const label = e.type === 'project'
    ? `[project: ${projectNameFor(userId, e.project_id) ?? e.project_id}]`
    : `[${e.type}]`;
  return `- ${label} ${e.key}: ${e.value}`;
}
```

In `buildSystemPrompt`, replace:

```ts
  const memory = recallAll(userId);
  const projects = getProjects(userId);
  const memoryText = Object.keys(memory).length > 0
    ? `\n\nUser memory:\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';
```

with:

```ts
  const memory = recallAll(userId);
  const projects = getProjects(userId);
  const memoryText = memory.length > 0
    ? `\n\nUser memory:\n${memory.map(e => formatMemoryEntry(userId, e)).join('\n')}`
    : '\n\nUser memory:\nNo memories stored yet.';
```

- [ ] **Step 7: Update `dispatchTool` switch cases**

Replace:

```ts
      case 'remember':
        result = remember(userId, toolInput.key as string, toolInput.value as string);
        break;
      case 'recall':
        result = recall(userId, (toolInput.key as string | undefined) ?? null);
        break;
```

with:

```ts
      case 'remember':
        result = remember(
          userId,
          toolInput.type as string,
          toolInput.key as string,
          toolInput.value as string,
          toolInput.project_id as string | undefined
        );
        break;
      case 'recall':
        result = recall(userId, toolInput.type as string | undefined, toolInput.key as string | undefined);
        break;
      case 'forget':
        result = forget(userId, toolInput.type as string, toolInput.key as string);
        break;
```

- [ ] **Step 8: Run agent tests to verify pass**

Run: `cd server && npx vitest run tests/services/agent.test.ts`
Expected: PASS (all tests in `agent.test.ts`)

- [ ] **Step 9: Run full server test suite**

Run: `cd server && npx vitest run`
Expected: PASS (all suites)

- [ ] **Step 10: Commit**

```bash
cd server && git add src/services/agent.ts tests/services/agent.test.ts tests/memory-route.test.ts
git commit -m "feat: render typed memory in system prompt and dispatch forget tool"
```

---

## Task 4: Scheduled tasks service, routes, and registration bootstrap

**Files:**
- Create: `server/src/services/scheduled_tasks.ts`
- Create: `server/src/routes/scheduled_tasks.ts`
- Modify: `server/src/routes/auth.ts`
- Modify: `server/src/index.ts`
- Create: `server/tests/services/scheduled_tasks.test.ts`
- Create: `server/tests/scheduled-tasks-route.test.ts`
- Modify: `server/tests/auth.test.ts`

- [ ] **Step 1: Write `server/tests/services/scheduled_tasks.test.ts`**

Create the file:

```ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb, createScheduledTask, getScheduledTaskForUser } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));

const runAgentTurnMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/agent.js', () => ({ runAgentTurn: runAgentTurnMock }));

const { runScheduledTask } = await import('../../src/services/scheduled_tasks.js');

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `sched-${userId}@test.com`, 'x');
});

describe('scheduled_tasks service', () => {
  it('runs a reorganize_memory task by creating a session, message, and calling runAgentTurn', async () => {
    const taskId = createScheduledTask(userId, 'reorganize_memory', 24);

    await runScheduledTask(userId, taskId);

    const db = getDb();
    const sessions = db.prepare("SELECT id, title FROM sessions WHERE user_id = ? AND title LIKE 'Memory reorganization%'").all(userId) as { id: string; title: string }[];
    expect(sessions.length).toBe(1);

    const messages = db.prepare('SELECT role, content FROM messages WHERE session_id = ?').all(sessions[0].id) as { role: string; content: string }[];
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('Review your stored memory using `recall`');

    expect(runAgentTurnMock).toHaveBeenCalledWith(userId, sessions[0].id, expect.any(String));

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).not.toBeNull();
    expect(updated?.next_run_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('throws for an unknown task type', async () => {
    const taskId = createScheduledTask(userId, 'unknown_type', 24);
    await expect(runScheduledTask(userId, taskId)).rejects.toThrow('Unknown scheduled task type');
  });
});
```

- [ ] **Step 2: Run service test to verify failure**

Run: `cd server && npx vitest run tests/services/scheduled_tasks.test.ts`
Expected: FAIL — `src/services/scheduled_tasks.ts` does not exist (module not found).

- [ ] **Step 3: Create `server/src/services/scheduled_tasks.ts`**

```ts
import { getDb, getScheduledTaskForUser, markScheduledTaskRun } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { runAgentTurn } from './agent.js';

const REORGANIZE_MEMORY_PROMPT = `Review your stored memory using \`recall\`. Look for: duplicate or
overlapping entries to merge, outdated/stale facts to \`forget\`, vague
entries that should be split into more specific ones, and entries that
should be re-typed (e.g. a \`feedback\` note that's actually a durable \`user\`
fact). Use \`remember\`/\`forget\` to apply changes. Reply with a short summary
of what you changed (or "No changes needed" if memory is already tidy).`;

async function runReorganizeMemory(userId: string): Promise<void> {
  const db = getDb();
  const sessionId = newId();
  const title = `Memory reorganization — ${new Date().toISOString().slice(0, 10)}`;
  db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(sessionId, userId, title);

  const messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(messageId, sessionId, 'user', REORGANIZE_MEMORY_PROMPT);

  await runAgentTurn(userId, sessionId, messageId);
}

export async function runScheduledTask(userId: string, taskId: string): Promise<void> {
  const task = getScheduledTaskForUser(taskId, userId);
  if (!task) throw new Error(`Scheduled task ${taskId} not found`);

  switch (task.type) {
    case 'reorganize_memory':
      await runReorganizeMemory(userId);
      break;
    default:
      throw new Error(`Unknown scheduled task type: ${task.type}`);
  }

  markScheduledTaskRun(task.id, Math.floor(Date.now() / 1000), task.interval_hours);
}
```

- [ ] **Step 4: Run service test to verify pass**

Run: `cd server && npx vitest run tests/services/scheduled_tasks.test.ts`
Expected: PASS (both tests)

Note: `sessions` table requires `effort` to default — confirmed it has `DEFAULT 'medium'`, so the insert without `effort` is fine.

- [ ] **Step 5: Write `server/tests/scheduled-tasks-route.test.ts`**

```ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { initDb, createScheduledTask, getScheduledTaskForUser } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';

vi.mock('../src/services/socket.js', () => ({ broadcast: vi.fn() }));
const runAgentTurnMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/agent.js', () => ({ runAgentTurn: runAgentTurnMock }));

const { app } = await import('../src/index.js');

let token: string;
let userId: string;
let taskId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `sched-route-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
  const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64').toString());
  userId = payload.userId;

  // Registration bootstraps a reorganize_memory task — fetch its id.
  const tasksRes = await request(app).get('/scheduled-tasks').set('Authorization', `Bearer ${token}`);
  taskId = tasksRes.body[0].id;
});

describe('scheduled-tasks routes', () => {
  it('GET /scheduled-tasks lists the bootstrapped reorganize_memory task', async () => {
    const res = await request(app).get('/scheduled-tasks').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toMatchObject({ type: 'reorganize_memory', interval_hours: 24, enabled: 1 });
  });

  it('PATCH /scheduled-tasks/:id updates enabled and interval_hours', async () => {
    const res = await request(app)
      .patch(`/scheduled-tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false, interval_hours: 12 });
    expect(res.status).toBe(200);

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.enabled).toBe(0);
    expect(updated?.interval_hours).toBe(12);
  });

  it('PATCH /scheduled-tasks/:id 404s for another user\'s task', async () => {
    const otherUserId = newId();
    const otherTaskId = createScheduledTask(otherUserId, 'reorganize_memory', 24);
    const res = await request(app)
      .patch(`/scheduled-tasks/${otherTaskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false });
    expect(res.status).toBe(404);
  });

  it('POST /scheduled-tasks/:id/run runs the task immediately', async () => {
    const res = await request(app)
      .post(`/scheduled-tasks/${taskId}/run`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(runAgentTurnMock).toHaveBeenCalled();

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).not.toBeNull();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/scheduled-tasks');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 6: Run route test to verify failure**

Run: `cd server && npx vitest run tests/scheduled-tasks-route.test.ts`
Expected: FAIL — `/scheduled-tasks` route not mounted (404s), and registration doesn't bootstrap a task yet.

- [ ] **Step 7: Create `server/src/routes/scheduled_tasks.ts`**

```ts
import { Router } from 'express';
import { getScheduledTasksForUser, getScheduledTaskForUser, updateScheduledTask } from '../db/index.js';
import { runScheduledTask } from '../services/scheduled_tasks.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json(getScheduledTasksForUser(userId));
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { enabled, interval_hours } = req.body as { enabled?: boolean; interval_hours?: number };

  const task = getScheduledTaskForUser(req.params.id, userId);
  if (!task) { res.status(404).json({ error: 'Scheduled task not found' }); return; }

  updateScheduledTask(req.params.id, userId, { enabled, interval_hours });
  res.json({ ok: true });
});

router.post('/:id/run', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const task = getScheduledTaskForUser(req.params.id, userId);
  if (!task) { res.status(404).json({ error: 'Scheduled task not found' }); return; }

  await runScheduledTask(userId, req.params.id);
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 8: Mount the route in `server/src/index.ts`**

Add the import:

```ts
import scheduledTasksRoutes from './routes/scheduled_tasks.js';
```

Add the route mount after `app.use('/memory', memoryRoutes);`:

```ts
app.use('/scheduled-tasks', scheduledTasksRoutes);
```

- [ ] **Step 9: Bootstrap the default task on registration**

In `server/src/routes/auth.ts`, add the import:

```ts
import { createScheduledTask } from '../db/index.js';
```

After the successful insert in `/register`:

```ts
  try {
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)').run(id, email, hashed);
  } catch {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }
```

add immediately below it (still inside the route handler, before `res.status(201).json(...)`):

```ts
  createScheduledTask(id, 'reorganize_memory', 24);
```

- [ ] **Step 10: Run route test to verify pass**

Run: `cd server && npx vitest run tests/scheduled-tasks-route.test.ts`
Expected: PASS (all tests)

- [ ] **Step 11: Update `server/tests/auth.test.ts` to assert bootstrap**

Add the import at the top:

```ts
import { getDb } from '../src/db/index.js';
```

In the `'creates first user'` test, after `expect(res.body.token).toBeDefined();`, add:

```ts
    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64').toString());
    const tasks = getDb().prepare('SELECT type, interval_hours, enabled FROM scheduled_tasks WHERE user_id = ?').all(payload.userId) as { type: string; interval_hours: number; enabled: number }[];
    expect(tasks).toContainEqual({ type: 'reorganize_memory', interval_hours: 24, enabled: 1 });
```

- [ ] **Step 12: Run full server test suite**

Run: `cd server && npx vitest run`
Expected: PASS (all suites)

- [ ] **Step 13: Commit**

```bash
cd server && git add src/services/scheduled_tasks.ts src/routes/scheduled_tasks.ts src/routes/auth.ts src/index.ts tests/services/scheduled_tasks.test.ts tests/scheduled-tasks-route.test.ts tests/auth.test.ts
git commit -m "feat: scheduled tasks service, API, and registration bootstrap"
```

---

## Task 5: In-process scheduler

**Files:**
- Create: `server/src/services/scheduler.ts`
- Modify: `server/src/index.ts`
- Create: `server/tests/services/scheduler.test.ts`

- [ ] **Step 1: Write `server/tests/services/scheduler.test.ts`**

```ts
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import { initDb, getDb, createScheduledTask, getScheduledTaskForUser } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));
const runAgentTurnMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/agent.js', () => ({ runAgentTurn: runAgentTurnMock }));

const { runDueScheduledTasks } = await import('../../src/services/scheduler.js');

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `scheduler-${userId}@test.com`, 'x');
});

afterEach(() => {
  runAgentTurnMock.mockClear();
});

describe('scheduler', () => {
  it('runs tasks whose next_run_at is due', async () => {
    const taskId = createScheduledTask(userId, 'reorganize_memory', 24);
    // Force it due now.
    getDb().prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 1, taskId);

    await runDueScheduledTasks();

    expect(runAgentTurnMock).toHaveBeenCalled();
    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).not.toBeNull();
  });

  it('does not run tasks that are not yet due', async () => {
    const taskId = createScheduledTask(userId, 'reorganize_memory', 24);
    // createScheduledTask already sets next_run_at = now + 24h, so it's not due.

    await runDueScheduledTasks();

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).toBeNull();
  });

  it('does not run disabled tasks', async () => {
    const taskId = createScheduledTask(userId, 'reorganize_memory', 24);
    getDb().prepare('UPDATE scheduled_tasks SET next_run_at = ?, enabled = 0 WHERE id = ?').run(Math.floor(Date.now() / 1000) - 1, taskId);

    await runDueScheduledTasks();

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).toBeNull();
  });

  it('continues to the next task if one fails', async () => {
    const failingTaskId = newId();
    getDb().prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, next_run_at) VALUES (?,?,?,?,?)')
      .run(failingTaskId, userId, 'unknown_type', 24, Math.floor(Date.now() / 1000) - 1);

    const okTaskId = createScheduledTask(userId, 'reorganize_memory', 24);
    getDb().prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 1, okTaskId);

    await runDueScheduledTasks();

    const okTask = getScheduledTaskForUser(okTaskId, userId);
    expect(okTask?.last_run_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run scheduler test to verify failure**

Run: `cd server && npx vitest run tests/services/scheduler.test.ts`
Expected: FAIL — `src/services/scheduler.ts` does not exist (module not found).

- [ ] **Step 3: Create `server/src/services/scheduler.ts`**

```ts
import { getDueScheduledTasks } from '../db/index.js';
import { runScheduledTask } from './scheduled_tasks.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export async function runDueScheduledTasks(): Promise<void> {
  const due = getDueScheduledTasks(Math.floor(Date.now() / 1000));
  for (const task of due) {
    try {
      await runScheduledTask(task.user_id, task.id);
    } catch (err) {
      console.error(`[scheduler] task ${task.id} (${task.type}) failed:`, err);
    }
  }
}

export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    runDueScheduledTasks().catch(err => console.error('[scheduler] error:', err));
  }, POLL_INTERVAL_MS);
}
```

- [ ] **Step 4: Run scheduler test to verify pass**

Run: `cd server && npx vitest run tests/services/scheduler.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Wire `startScheduler` into `server/src/index.ts`**

Add the import:

```ts
import { startScheduler } from './services/scheduler.js';
```

Inside the existing `if (NODE_ENV !== 'test') { ... }` block, after `server.listen(...)`:

```ts
if (NODE_ENV !== 'test') {
  server.listen(parseInt(PORT), () => {
    console.log(`Server running on port ${PORT}`);
  });
  startScheduler();
}
```

- [ ] **Step 6: Run full server test suite**

Run: `cd server && npx vitest run`
Expected: PASS (all suites)

- [ ] **Step 7: Commit**

```bash
cd server && git add src/services/scheduler.ts src/index.ts tests/services/scheduler.test.ts
git commit -m "feat: in-process scheduler for due scheduled tasks"
```

---

## Task 6: Frontend types and API client

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Add `Memory` and `ScheduledTask` types**

In `web/src/types.ts`, add at the end of the file:

```ts
export interface Memory {
  type: 'user' | 'feedback' | 'project' | 'reference';
  key: string;
  value: string;
  project_id: string | null;
}

export interface ScheduledTask {
  id: string;
  type: string;
  interval_hours: number;
  enabled: number;
  next_run_at: number;
  last_run_at: number | null;
}
```

- [ ] **Step 2: Update `web/src/lib/api.ts`**

Update the type-only import at the top:

```ts
import type { Session, Message, Project, Connection, EffortLevel, ClaudeModelInfo, UserSettings } from '../types.js';
```

becomes:

```ts
import type { Session, Message, Project, Connection, EffortLevel, ClaudeModelInfo, UserSettings, Memory, ScheduledTask } from '../types.js';
```

Replace:

```ts
export function getMemory(): Promise<Record<string, string>> {
  return request('/memory');
}
```

with:

```ts
export function getMemory(): Promise<Memory[]> {
  return request('/memory');
}

export function getScheduledTasks(): Promise<ScheduledTask[]> {
  return request('/scheduled-tasks');
}

export function updateScheduledTask(id: string, body: { enabled?: boolean; interval_hours?: number }): Promise<void> {
  return request(`/scheduled-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function runScheduledTask(id: string): Promise<void> {
  return request(`/scheduled-tasks/${id}/run`, { method: 'POST' });
}
```

- [ ] **Step 3: Verify frontend type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: errors only in `Settings.tsx` (still using the old `Record<string,string>` memory shape) — fixed in Task 7. No errors in `types.ts` or `api.ts` themselves.

- [ ] **Step 4: Commit**

```bash
cd web && git add src/types.ts src/lib/api.ts
git commit -m "feat: add Memory and ScheduledTask types and API helpers"
```

---

## Task 7: Settings page — grouped memory display and scheduled tasks section

**Files:**
- Modify: `web/src/pages/Settings.tsx`

- [ ] **Step 1: Update imports**

Replace:

```tsx
import {
  createConnection,
  createProject,
  deleteConnection,
  deleteProject,
  getConnections,
  getMemory,
  getProjects,
  getSettings,
  updateSettings,
} from '../lib/api.js';
import { clearToken } from '../lib/auth.js';
import type { Connection, Project, UserSettings } from '../types.js';
```

with:

```tsx
import {
  createConnection,
  createProject,
  deleteConnection,
  deleteProject,
  getConnections,
  getMemory,
  getProjects,
  getScheduledTasks,
  getSettings,
  runScheduledTask,
  updateScheduledTask,
  updateSettings,
} from '../lib/api.js';
import { clearToken } from '../lib/auth.js';
import type { Connection, Memory, Project, ScheduledTask, UserSettings } from '../types.js';
```

- [ ] **Step 2: Replace the `memory` query and add a `scheduledTasks` query**

Replace:

```tsx
  const { data: memory = {} } = useQuery<Record<string, string>>({ queryKey: ['memory'], queryFn: getMemory });
```

with:

```tsx
  const { data: memory = [] } = useQuery<Memory[]>({ queryKey: ['memory'], queryFn: getMemory });
  const { data: scheduledTasks = [] } = useQuery<ScheduledTask[]>({ queryKey: ['scheduledTasks'], queryFn: getScheduledTasks });
```

- [ ] **Step 3: Add scheduled task mutations**

After the `updateSettingsMutation` definition, add:

```tsx
  const updateTaskMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { enabled?: boolean; interval_hours?: number } }) => updateScheduledTask(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduledTasks'] }),
  });

  const runTaskMutation = useMutation({
    mutationFn: runScheduledTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduledTasks'] }),
  });
```

- [ ] **Step 4: Replace the Memory section with a grouped, typed display**

Replace:

```tsx
      <Section title="Memory">
        {Object.keys(memory).length === 0 ? (
          <div className="text-muted-foreground/70 text-sm">No memory stored yet.</div>
        ) : (
          <div className="grid gap-2">
            {Object.entries(memory).map(([k, v]) => (
              <div key={k} className={rowCls}>
                <div className="w-36 text-muted-foreground text-sm font-mono shrink-0">{k}</div>
                <div className="flex-1 text-foreground/75 text-sm">{v}</div>
              </div>
            ))}
          </div>
        )}
      </Section>
```

with:

```tsx
      <Section title="Memory">
        {memory.length === 0 ? (
          <div className="text-muted-foreground/70 text-sm">No memory stored yet.</div>
        ) : (
          <div className="grid gap-4">
            {(['user', 'feedback', 'project', 'reference'] as const).map(type => {
              const entries = memory.filter(m => m.type === type);
              if (entries.length === 0) return null;
              return (
                <div key={type}>
                  <h3 className="mb-2 text-sm font-medium capitalize text-muted-foreground">{type}</h3>
                  <div className="grid gap-2">
                    {entries.map(m => (
                      <div key={`${m.type}-${m.key}`} className={rowCls}>
                        <div className="w-40 text-muted-foreground text-sm font-mono shrink-0">
                          {m.key}
                          {m.type === 'project' && (
                            <div className="text-muted-foreground/60 text-xs font-sans">
                              {projects.find(p => p.id === m.project_id)?.name ?? m.project_id}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 text-foreground/75 text-sm">{m.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Scheduled Tasks">
        {scheduledTasks.length === 0 ? (
          <div className="text-muted-foreground/70 text-sm">No scheduled tasks.</div>
        ) : (
          <div className="grid gap-2">
            {scheduledTasks.map(task => (
              <div key={task.id} className={rowCls}>
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {task.type === 'reorganize_memory' ? 'Memory reorganization' : task.type}
                  </div>
                  <div className="text-muted-foreground/70 text-xs mt-0.5">
                    {task.last_run_at
                      ? `Last ran ${new Date(task.last_run_at * 1000).toLocaleString()}`
                      : 'Never run'}
                  </div>
                </div>
                <button onClick={() => runTaskMutation.mutate(task.id)} className={ghostBtn}>
                  Run now
                </button>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!task.enabled}
                    onChange={e => updateTaskMutation.mutate({ id: task.id, body: { enabled: e.target.checked } })}
                    className="h-4 w-4 rounded border-border bg-background accent-primary"
                  />
                  <span className="text-sm text-foreground/70">Enabled</span>
                </label>
              </div>
            ))}
          </div>
        )}
      </Section>
```

- [ ] **Step 5: Type-check and lint**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

Run: `cd web && npx eslint src/pages/Settings.tsx`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Start the dev server (`cd web && npm run dev` and `cd server && npm run dev` in separate terminals, or whatever the project's existing dev script is — check `package.json` scripts if unsure). Log in, open Settings, and verify:
- Memory section shows "No memory stored yet." on a fresh account.
- Scheduled Tasks section shows "Memory reorganization" with "Never run", an enabled checkbox, and a "Run now" button.
- Toggling the checkbox and clicking "Run now" do not error (check browser console/network tab).

- [ ] **Step 7: Commit**

```bash
cd web && git add src/pages/Settings.tsx
git commit -m "feat: grouped memory display and scheduled tasks section in Settings"
```

---

## Final Steps

- [ ] **Run the full test suite one more time**

Run: `cd server && npx vitest run && cd ../web && npx tsc --noEmit`
Expected: all server tests PASS, web type-check clean.

- [ ] **Use superpowers:finishing-a-development-branch** to verify tests, present merge/PR/keep/discard options, and clean up.
