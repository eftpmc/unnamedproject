# Lead Agent Tool Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lead agent's static "send all 40 tools every turn" model with a searchable tool registry (first-party + MCP) discovered via a new `tool_search` tool, while keeping agent-role delegation (`delegate_to_agent`) as a separate, always-visible, non-searched surface.

**Architecture:** A `tool_search` tool (keyword/fuzzy match) joins the existing static `toolDefinitions` array with a new DB-backed `tool_registry` table populated when MCP connections are tested. Discovered tools are pinned per-session (DB column on `sessions`) and unioned into every subsequent turn's `tools` array alongside a small always-loaded core set. `mcp_call`, `getToolSubset`, and `Intent.scope` are removed as dead/superseded.

**Tech Stack:** TypeScript, better-sqlite3, Anthropic SDK (`@anthropic-ai/sdk`), Vitest.

## Global Constraints

- Search mechanism: keyword/fuzzy match against `name` + `description` — no embeddings, no extra LLM call.
- Discovered tools persist for the lifetime of the session (never re-searched once surfaced).
- Agent roles (`delegate_to_agent`) are NOT part of the registry or `tool_search` — they stay in the always-loaded core set, unchanged in shape.
- No new agent roles are defined in this plan — mechanism only.
- `Intent.domain` / `Intent.complexity` are unchanged (still drive prose framing + model tier). Only `Intent.scope` is removed.
- Follow existing code style: synchronous `better-sqlite3` `prepare().run()/.get()/.all()` calls, no ORM, functions exported individually from `db/index.ts`.

---

### Task 1: DB schema — `tool_registry` table and `sessions.discovered_tools` column

**Files:**
- Modify: `server/src/db/index.ts:22-25` (migrations array), and add new exported functions near the other table-specific helpers (e.g. after `getPipelineTasks` around line 1305).
- Test: `server/tests/db/tool_registry.test.ts` (new)

**Interfaces:**
- Produces:
  - `upsertMcpRegistryTools(userId: string, connectionId: string, tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>): void`
  - `getMcpRegistryToolsForUser(userId: string): DbRegistryTool[]`
  - `getMcpRegistryTool(userId: string, toolName: string): DbRegistryTool | undefined`
  - `getSessionDiscoveredTools(sessionId: string): string[]`
  - `addSessionDiscoveredTools(sessionId: string, toolNames: string[]): void`
  - `export interface DbRegistryTool { id: string; user_id: string; connection_id: string; tool_name: string; mcp_tool_name: string; description: string; input_schema: string; created_at: number; updated_at: number; }`

- [ ] **Step 1: Add the migration**

In `server/src/db/index.ts`, add a new migration after the existing version 2 entry:

```typescript
const migrations: Migration[] = [
  { version: 1, name: 'baseline-schema', noTransaction: true, up: () => applySchema() },
  { version: 2, name: 'repair-plan-foreign-keys', noTransaction: true, up: repairPlanForeignKeys },
  { version: 3, name: 'tool-registry', up: addToolRegistry },
];
```

Add the migration function near `repairPlanForeignKeys`:

```typescript
function addToolRegistry(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tool_registry (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      mcp_tool_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      input_schema TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(connection_id, mcp_tool_name),
      UNIQUE(user_id, tool_name)
    );
  `);

  const sessionCols = database.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionCols.some(c => c.name === 'discovered_tools')) {
    database.exec("ALTER TABLE sessions ADD COLUMN discovered_tools TEXT NOT NULL DEFAULT '[]'");
  }
}
```

- [ ] **Step 2: Add the registry accessor functions**

Add to `server/src/db/index.ts`, after the existing pipeline helpers:

```typescript
export interface DbRegistryTool {
  id: string;
  user_id: string;
  connection_id: string;
  tool_name: string;
  mcp_tool_name: string;
  description: string;
  input_schema: string;
  created_at: number;
  updated_at: number;
}

export function upsertMcpRegistryTools(
  userId: string,
  connectionId: string,
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
): void {
  const upsert = getDb().prepare(`
    INSERT INTO tool_registry (id, user_id, connection_id, tool_name, mcp_tool_name, description, input_schema, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(connection_id, mcp_tool_name) DO UPDATE SET
      tool_name = excluded.tool_name,
      description = excluded.description,
      input_schema = excluded.input_schema,
      updated_at = unixepoch()
  `);
  const tx = getDb().transaction((rows: typeof tools) => {
    for (const t of rows) {
      const qualifiedName = qualifyMcpToolName(connectionId, t.name);
      upsert.run(newId(), userId, connectionId, qualifiedName, t.name, t.description ?? '', JSON.stringify(t.inputSchema ?? {}));
    }
  });
  tx(tools);
}

function qualifyMcpToolName(connectionId: string, mcpToolName: string): string {
  const sanitized = mcpToolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const shortConn = connectionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 8);
  return `mcp_${shortConn}_${sanitized}`.slice(0, 128);
}

export function getMcpRegistryToolsForUser(userId: string): DbRegistryTool[] {
  return getDb()
    .prepare('SELECT * FROM tool_registry WHERE user_id = ? ORDER BY tool_name')
    .all(userId) as DbRegistryTool[];
}

export function getMcpRegistryTool(userId: string, toolName: string): DbRegistryTool | undefined {
  return getDb()
    .prepare('SELECT * FROM tool_registry WHERE user_id = ? AND tool_name = ?')
    .get(userId, toolName) as DbRegistryTool | undefined;
}

export function getSessionDiscoveredTools(sessionId: string): string[] {
  const row = getDb()
    .prepare('SELECT discovered_tools FROM sessions WHERE id = ?')
    .get(sessionId) as { discovered_tools: string } | undefined;
  return row ? JSON.parse(row.discovered_tools) as string[] : [];
}

export function addSessionDiscoveredTools(sessionId: string, toolNames: string[]): void {
  const existing = new Set(getSessionDiscoveredTools(sessionId));
  for (const name of toolNames) existing.add(name);
  getDb()
    .prepare('UPDATE sessions SET discovered_tools = ? WHERE id = ?')
    .run(JSON.stringify([...existing]), sessionId);
}
```

- [ ] **Step 3: Write the failing test**

Create `server/tests/db/tool_registry.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('tool_registry', () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-registry-test-'));
    process.env.DATA_DIR = dataDir;
    process.env.MASTER_KEY = 'test-master-key-32-bytes-long!!';
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('upserts MCP tools and resolves them by qualified name', async () => {
    const { initDb, getDb, upsertMcpRegistryTools, getMcpRegistryToolsForUser, getMcpRegistryTool } = await import('../../src/db/index.js');
    initDb();
    const userId = 'user-1';
    const connId = 'conn-1';
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, 'a@b.com', 'x');
    getDb().prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)").run(connId, userId, 'gh-mcp', 'mcp', 'enc');

    upsertMcpRegistryTools(userId, connId, [
      { name: 'create_pr', description: 'Create a pull request', inputSchema: { type: 'object', properties: {} } },
    ]);

    const tools = getMcpRegistryToolsForUser(userId);
    expect(tools).toHaveLength(1);
    expect(tools[0].mcp_tool_name).toBe('create_pr');

    const resolved = getMcpRegistryTool(userId, tools[0].tool_name);
    expect(resolved?.connection_id).toBe(connId);
  });

  it('upserting the same MCP tool again updates rather than duplicates', async () => {
    const { getDb, upsertMcpRegistryTools, getMcpRegistryToolsForUser } = await import('../../src/db/index.js');
    const userId = 'user-1';
    const connId = 'conn-1';

    upsertMcpRegistryTools(userId, connId, [
      { name: 'create_pr', description: 'Create a PR (updated)', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } },
    ]);

    const tools = getMcpRegistryToolsForUser(userId);
    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe('Create a PR (updated)');
  });

  it('tracks discovered tools per session, deduplicated', async () => {
    const { getDb, addSessionDiscoveredTools, getSessionDiscoveredTools } = await import('../../src/db/index.js');
    const userId = 'user-1';
    const sessionId = 'session-1';
    getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);

    addSessionDiscoveredTools(sessionId, ['read_file', 'tool_search']);
    addSessionDiscoveredTools(sessionId, ['read_file', 'mcp_abc123_create_pr']);

    expect(getSessionDiscoveredTools(sessionId).sort()).toEqual(['mcp_abc123_create_pr', 'read_file', 'tool_search'].sort());
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd server && npx vitest run tests/db/tool_registry.test.ts`
Expected: FAIL — `upsertMcpRegistryTools` is not exported / migration doesn't exist yet.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run tests/db/tool_registry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/db/index.ts server/tests/db/tool_registry.test.ts
git commit -m "feat(server): add tool_registry table and session discovered-tools tracking"
```

---

### Task 2: Capture MCP tool input schemas in `listMcpTools`

**Files:**
- Modify: `server/src/lib/mcp-pool.ts:39-50`
- Test: `server/tests/lib/mcp-pool.test.ts` (new, or extend existing if present — check first with `ls server/tests/lib/`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `listMcpTools` now returns `Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>` (was `Array<{ name: string; description?: string }>`).

**Why:** The MCP `tools/list` response already includes `inputSchema` per the MCP protocol — this codebase currently discards it. Task 3's registry ingestion needs it to register MCP tools with real typed schemas instead of a generic passthrough.

- [ ] **Step 1: Update the return type and parsing**

In `server/src/lib/mcp-pool.ts`, replace:

```typescript
export async function listMcpTools(
  connectionId: string,
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<Array<{ name: string; description?: string }>> {
  let connPromise = pool.get(connectionId);
  if (!connPromise) {
    connPromise = createConn(command, args, env).catch(err => {
      pool.delete(connectionId);
      throw err;
    });
    pool.set(connectionId, connPromise);
  }
  const conn = await connPromise;
  const raw = await sendRequest(conn, 'tools/list', {});
  const parsed = JSON.parse(raw) as { tools?: Array<{ name: string; description?: string }> };
  return parsed.tools ?? [];
}
```

with:

```typescript
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export async function listMcpTools(
  connectionId: string,
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<McpToolInfo[]> {
  let connPromise = pool.get(connectionId);
  if (!connPromise) {
    connPromise = createConn(command, args, env).catch(err => {
      pool.delete(connectionId);
      throw err;
    });
    pool.set(connectionId, connPromise);
  }
  const conn = await connPromise;
  const raw = await sendRequest(conn, 'tools/list', {});
  const parsed = JSON.parse(raw) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
  return (parsed.tools ?? []).map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema ?? { type: 'object', properties: {} } }));
}
```

No call sites need code changes yet — `agent.ts`'s existing `.map(t => ({ name: t.name, description: t.description }))` calls (in `list_connections` and `test_connection`, currently lines 855 and 892) still work unchanged since they only read `name`/`description` off the richer object. Task 7 will add a third call site that uses `inputSchema`.

- [ ] **Step 2: Write the failing test**

First check whether `server/tests/lib/mcp-pool.test.ts` already exists:

Run: `ls server/tests/lib/ 2>/dev/null`

If it doesn't exist, create `server/tests/lib/mcp-pool.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('listMcpTools', () => {
  it('includes inputSchema in returned tool info', async () => {
    const { spawn } = await import('child_process');
    const { EventEmitter } = await import('events');

    const stdout = new EventEmitter();
    const stdin = { write: vi.fn() };
    const proc = Object.assign(new EventEmitter(), { stdout, stdin });
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const { listMcpTools } = await import('../../src/lib/mcp-pool.js');

    const resultPromise = listMcpTools('conn-1', 'mock-mcp', [], {});

    // Simulate the init handshake response, then the tools/list response.
    queueMicrotask(() => {
      stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 0, result: {} }) + '\n'));
      queueMicrotask(() => {
        stdout.emit('data', Buffer.from(JSON.stringify({
          jsonrpc: '2.0', id: 1,
          result: { tools: [{ name: 'create_pr', description: 'Create a PR', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }] },
        }) + '\n'));
      });
    });

    const tools = await resultPromise;
    expect(tools[0].name).toBe('create_pr');
    expect(tools[0].inputSchema).toEqual({ type: 'object', properties: { title: { type: 'string' } } });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run tests/lib/mcp-pool.test.ts`
Expected: FAIL — `inputSchema` is `undefined` before the fix, or the mock doesn't yet match the implementation's request IDs (adjust the test's `id: 1` to match whatever ID `sendRequest` actually assigns on the second call — check `nextId` starts at 1, so the first real request after init is id 1; verify against `mcp-pool.ts:28` `nextId: 1`).

- [ ] **Step 4: Implement the fix from Step 1, then run test to verify it passes**

Run: `cd server && npx vitest run tests/lib/mcp-pool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/mcp-pool.ts server/tests/lib/mcp-pool.test.ts
git commit -m "feat(server): capture MCP tool input schemas in listMcpTools"
```

---

### Task 3: `toolRegistry` service — ingestion and resolution

**Files:**
- Create: `server/src/services/toolRegistry.ts`
- Test: `server/tests/services/toolRegistry.test.ts`

**Interfaces:**
- Consumes: `listMcpTools` (Task 2), `upsertMcpRegistryTools`, `getMcpRegistryToolsForUser`, `getMcpRegistryTool` (Task 1), `getDecryptedConfig` from `server/src/routes/connections.ts`.
- Produces:
  - `ingestMcpTools(userId: string, connectionId: string): Promise<void>`
  - `getRegistrySearchPool(userId: string): Array<{ name: string; description: string }>` — MCP entries only (first-party is handled separately in Task 4, which also owns exclusion of `delegate_to_agent`).
  - `resolveRegistryTool(userId: string, toolName: string): Anthropic.Tool | undefined`
  - `dispatchRegistryTool(userId: string, toolName: string, toolInput: Record<string, unknown>): Promise<string | undefined>` — returns `undefined` if `toolName` isn't a registered MCP tool (so the caller in `agent.ts` can fall through to "unknown tool").

- [ ] **Step 1: Write the failing test**

Create `server/tests/services/toolRegistry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../src/lib/mcp-pool.js', () => ({
  listMcpTools: vi.fn(async () => [
    { name: 'create_pr', description: 'Create a pull request', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  ]),
  callMcpTool: vi.fn(async () => 'PR #42 created'),
}));

vi.mock('../../src/routes/connections.js', () => ({
  getDecryptedConfig: vi.fn(() => ({ command: 'mock-mcp', args: '[]', env: '{}' })),
}));

describe('toolRegistry', () => {
  let dataDir: string;
  const userId = 'user-1';
  const connId = 'conn-1';

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-registry-svc-test-'));
    process.env.DATA_DIR = dataDir;
    process.env.MASTER_KEY = 'test-master-key-32-bytes-long!!';
    const { initDb, getDb } = await import('../../src/db/index.js');
    initDb();
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, 'a@b.com', 'x');
    getDb().prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)").run(connId, userId, 'gh-mcp', 'mcp', 'enc');
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests MCP tools into the registry', async () => {
    const { ingestMcpTools, getRegistrySearchPool } = await import('../../src/services/toolRegistry.js');
    await ingestMcpTools(userId, connId);

    const pool = getRegistrySearchPool(userId);
    expect(pool).toHaveLength(1);
    expect(pool[0].description).toContain('Create a pull request');
  });

  it('resolves a registered tool by its qualified name with the real input schema', async () => {
    const { ingestMcpTools, getRegistrySearchPool, resolveRegistryTool } = await import('../../src/services/toolRegistry.js');
    await ingestMcpTools(userId, connId);
    const pool = getRegistrySearchPool(userId);
    const qualifiedName = (await import('../../src/db/index.js')).getMcpRegistryToolsForUser(userId)[0].tool_name;

    const tool = resolveRegistryTool(userId, qualifiedName);
    expect(tool?.name).toBe(qualifiedName);
    expect(tool?.input_schema).toEqual({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] });
  });

  it('dispatches a registered tool call through callMcpTool', async () => {
    const { ingestMcpTools, dispatchRegistryTool } = await import('../../src/services/toolRegistry.js');
    await ingestMcpTools(userId, connId);
    const qualifiedName = (await import('../../src/db/index.js')).getMcpRegistryToolsForUser(userId)[0].tool_name;

    const result = await dispatchRegistryTool(userId, qualifiedName, { title: 'fix bug' });
    expect(result).toBe('PR #42 created');
  });

  it('returns undefined for a name not in the registry', async () => {
    const { dispatchRegistryTool } = await import('../../src/services/toolRegistry.js');
    const result = await dispatchRegistryTool(userId, 'not_a_real_tool', {});
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/services/toolRegistry.test.ts`
Expected: FAIL — `server/src/services/toolRegistry.ts` does not exist.

- [ ] **Step 3: Implement `toolRegistry.ts`**

Create `server/src/services/toolRegistry.ts`:

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import { getDb, upsertMcpRegistryTools, getMcpRegistryToolsForUser, getMcpRegistryTool } from '../db/index.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { listMcpTools, callMcpTool } from '../lib/mcp-pool.js';

export async function ingestMcpTools(userId: string, connectionId: string): Promise<void> {
  const cfg = getDecryptedConfig(connectionId, userId);
  const mcpArgs = cfg.args ? JSON.parse(cfg.args) : [];
  const mcpEnv = cfg.env ? JSON.parse(cfg.env) : {};
  const tools = await listMcpTools(connectionId, cfg.command, mcpArgs, mcpEnv);
  upsertMcpRegistryTools(
    userId,
    connectionId,
    tools.map(t => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema })),
  );
}

export function getRegistrySearchPool(userId: string): Array<{ name: string; description: string }> {
  return getMcpRegistryToolsForUser(userId).map(t => ({ name: t.tool_name, description: t.description }));
}

export function resolveRegistryTool(userId: string, toolName: string): Anthropic.Tool | undefined {
  const row = getMcpRegistryTool(userId, toolName);
  if (!row) return undefined;
  return {
    name: row.tool_name,
    description: row.description,
    input_schema: JSON.parse(row.input_schema),
  };
}

export async function dispatchRegistryTool(
  userId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<string | undefined> {
  const row = getMcpRegistryTool(userId, toolName);
  if (!row) return undefined;
  const cfg = getDecryptedConfig(row.connection_id, userId);
  const mcpArgs = cfg.args ? JSON.parse(cfg.args) : [];
  const mcpEnv = cfg.env ? JSON.parse(cfg.env) : {};
  return callMcpTool(row.connection_id, cfg.command, mcpArgs, mcpEnv, row.mcp_tool_name, toolInput);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/services/toolRegistry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/toolRegistry.ts server/tests/services/toolRegistry.test.ts
git commit -m "feat(server): add toolRegistry service for MCP tool ingestion and dispatch"
```

---

### Task 4: `toolSearch` service — keyword/fuzzy matching across first-party + MCP

**Files:**
- Create: `server/src/services/toolSearch.ts`
- Test: `server/tests/services/toolSearch.test.ts`

**Interfaces:**
- Consumes: `toolDefinitions` from `server/src/tools/definitions.ts` (Task 5 will have already removed `mcp_call` and added `tool_search` to this array — write this task assuming that's already true; if executed before Task 5, temporarily reference `toolDefinitions` as-is and the `EXCLUDED_FROM_SEARCH` set below will simply have no effect on `mcp_call`/`tool_search` yet), `getRegistrySearchPool` from `server/src/services/toolRegistry.ts` (Task 3).
- Produces:
  - `searchTools(userId: string, query: string, limit?: number): Array<{ name: string; description: string }>`
  - `EXCLUDED_FROM_SEARCH: Set<string>` — tool names that exist in `toolDefinitions` but must never appear in search results because they belong to the always-loaded core set or the separate agent-role surface (`tool_search` itself, and `delegate_to_agent`).

- [ ] **Step 1: Write the failing test**

Create `server/tests/services/toolSearch.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/toolRegistry.js', () => ({
  getRegistrySearchPool: vi.fn(() => [
    { name: 'mcp_abc12345_create_pr', description: 'Create a GitHub pull request' },
  ]),
}));

describe('searchTools', () => {
  it('matches first-party tools by description keyword', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'render a video');
    expect(results.map(r => r.name)).toContain('generate_video');
  });

  it('matches MCP registry tools by description keyword', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'github pull request');
    expect(results.map(r => r.name)).toContain('mcp_abc12345_create_pr');
  });

  it('never returns delegate_to_agent or tool_search', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'spawn a sub agent to search tools');
    expect(results.map(r => r.name)).not.toContain('delegate_to_agent');
    expect(results.map(r => r.name)).not.toContain('tool_search');
  });

  it('returns an empty array for a query matching nothing', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'zzz_no_such_capability_zzz');
    expect(results).toEqual([]);
  });

  it('caps results at the given limit', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'project', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/services/toolSearch.test.ts`
Expected: FAIL — `server/src/services/toolSearch.ts` does not exist.

- [ ] **Step 3: Implement `toolSearch.ts`**

Create `server/src/services/toolSearch.ts`:

```typescript
import { toolDefinitions } from '../tools/definitions.js';
import { getRegistrySearchPool } from './toolRegistry.js';

export const EXCLUDED_FROM_SEARCH = new Set(['tool_search', 'delegate_to_agent']);

interface SearchCandidate {
  name: string;
  description: string;
}

function score(query: string, candidate: SearchCandidate): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${candidate.name} ${candidate.description}`.toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (haystack.includes(term)) matched++;
  }
  return matched;
}

export function searchTools(userId: string, query: string, limit = 5): Array<{ name: string; description: string }> {
  const firstParty: SearchCandidate[] = toolDefinitions
    .filter(t => !EXCLUDED_FROM_SEARCH.has(t.name))
    .map(t => ({ name: t.name, description: t.description ?? '' }));

  const mcp = getRegistrySearchPool(userId);

  const pool = [...firstParty, ...mcp];

  return pool
    .map(c => ({ candidate: c, score: score(query, c) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => r.candidate);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/services/toolSearch.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/toolSearch.ts server/tests/services/toolSearch.test.ts
git commit -m "feat(server): add toolSearch service for keyword matching over first-party and MCP tools"
```

---

### Task 5: `definitions.ts` — remove `mcp_call`, add `tool_search`

**Files:**
- Modify: `server/src/tools/definitions.ts:32-45` (remove `mcp_call` entry), and add `tool_search` entry.
- Test: `server/tests/tools/definitions.test.ts` (new)

**Interfaces:**
- Produces: `toolDefinitions` no longer contains a `mcp_call` entry; gains a `tool_search` entry with `input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/tools/definitions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { toolDefinitions } from '../../src/tools/definitions.js';

describe('toolDefinitions', () => {
  it('does not include mcp_call', () => {
    expect(toolDefinitions.map(t => t.name)).not.toContain('mcp_call');
  });

  it('includes tool_search with a query input', () => {
    const toolSearch = toolDefinitions.find(t => t.name === 'tool_search');
    expect(toolSearch).toBeDefined();
    expect(toolSearch?.input_schema.required).toContain('query');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/tools/definitions.test.ts`
Expected: FAIL — `mcp_call` still present, `tool_search` missing.

- [ ] **Step 3: Edit `definitions.ts`**

Remove lines 32-45 (the `mcp_call` entry) from `server/src/tools/definitions.ts`.

Add this entry immediately after the `invoke_codex` entry (where `mcp_call` used to be), to keep "always-loaded core" tools grouped near the top:

```typescript
  {
    name: 'tool_search',
    description: 'Search for a tool by describing what you need to do. Returns the best-matching tools (name + description) across first-party tools and connected MCP servers. Once a tool is returned here, you can call it directly by name on this or any later turn in the conversation — it stays available for the rest of the session. If nothing relevant comes back, try rephrasing the query. Does not search agent roles — use delegate_to_agent directly for sub-agent delegation.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Describe the capability you need, e.g. "create a github pull request" or "render a video from scenes"' },
      },
      required: ['query'],
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/tools/definitions.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/tools/definitions.ts server/tests/tools/definitions.test.ts
git commit -m "feat(server): remove mcp_call, add tool_search to tool definitions"
```

---

### Task 6: `intent.ts` — remove `scope`

**Files:**
- Modify: `server/src/services/intent.ts` (whole file is short — edit directly)
- Modify: `server/tests/services/intent.test.ts:5-60` (remove `scope` assertions)

**Interfaces:**
- Produces: `Intent` interface no longer has a `scope` field. `DEFAULT_INTENT` and `classifyIntent()` no longer set it.

- [ ] **Step 1: Update `server/tests/services/intent.test.ts` first (defines the target behavior)**

Remove every line asserting on `.scope` and the `PLAN_RE`-driven "routes coordinated multi-step work to plan scope" test, since that behavior is being deleted:

Replace the file's `it` blocks for `'classifies a code task and delegates it'`, `'classifies a research task and flags needs_research'`, `'classifies a writing task'`, and `'routes coordinated multi-step work to plan scope'` with:

```typescript
  it('classifies a code task', () => {
    const intent = classifyIntent('fix the login bug in the api');
    expect(intent.domain).toBe('code');
    expect(intent.ambiguous).toBe(false);
    expect(intent.tools).toEqual([]);
  });

  it('classifies a research task and flags needs_research', () => {
    const intent = classifyIntent('explain how photosynthesis works');
    expect(intent.domain).toBe('research');
    expect(intent.needs_research).toBe(true);
  });

  it('classifies a writing task', () => {
    const intent = classifyIntent('draft an email to the team');
    expect(intent.domain).toBe('writing');
    expect(intent.needs_research).toBe(false);
  });
```

Delete the `'routes coordinated multi-step work to plan scope'` test entirely (no replacement — that behavior is gone).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/services/intent.test.ts`
Expected: FAIL — current `classifyIntent` still returns `scope`, which is fine (extra field doesn't fail `toMatchObject`/`toBe` checks above), but this step is really about confirming the *removed* assertions are gone before the source change. If it currently passes as-is, that's expected since we haven't broken anything yet — proceed to Step 3 regardless.

- [ ] **Step 3: Edit `server/src/services/intent.ts`**

Remove `scope: 'inline' | 'delegate' | 'plan';` from the `Intent` interface (line 6).

Remove `scope: 'inline',` from `DEFAULT_INTENT` (line 16).

Remove the `PLAN_RE` constant (line 27) and the `scope` computation block (lines 55-57):

```typescript
  const scope: Intent['scope'] = PLAN_RE.test(msg) ? 'plan'
    : (isCode && !isLowComplexity) ? 'delegate'
    : 'inline';
```

Remove `scope,` from the returned object (line 64).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/services/intent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/services/intent.ts server/tests/services/intent.test.ts
git commit -m "refactor(server): remove unused Intent.scope field"
```

---

### Task 7: `context.ts` — remove `getToolSubset`, update prose blocks

**Files:**
- Modify: `server/src/services/context.ts:1-9` (imports), `:27-54` (`baseBlock`), `:51` (MCP connections prose), `:114-118` (research domain prose), `:267-313` (delete tool-subsetting section entirely)
- Modify: `server/tests/services/context.test.ts:145-182` (remove `getToolSubset` describe block)

**Interfaces:**
- Produces: `context.ts` no longer exports `getToolSubset`. `Anthropic` type import (used only by the deleted function's return type) is removed if otherwise unused — check first, since `buildContext`'s own signature doesn't need it.

- [ ] **Step 1: Update `server/tests/services/context.test.ts` first**

Delete the entire `describe('getToolSubset', ...)` block (lines 145-182) and remove the now-unused `getToolSubset` and `toolDefinitions` imports from the test file's top if nothing else in the file uses them — check with:

Run: `grep -n "toolDefinitions\|getToolSubset" server/tests/services/context.test.ts`

Remove only the imports/usages tied to the deleted block; leave any unrelated usages intact.

Also update lines 23-25 — these `Intent`-typed consts still set a `scope` field, which Task 6 removes from the `Intent` interface (if Task 6 ran before this task, this file is currently failing to typecheck). Replace:

```typescript
const codeIntent: Intent = { ...DEFAULT_INTENT, domain: 'code', scope: 'delegate' };
const writingIntent: Intent = { ...DEFAULT_INTENT, domain: 'writing', scope: 'inline' };
const researchIntent: Intent = { ...DEFAULT_INTENT, domain: 'research', scope: 'inline' };
```

with:

```typescript
const codeIntent: Intent = { ...DEFAULT_INTENT, domain: 'code' };
const writingIntent: Intent = { ...DEFAULT_INTENT, domain: 'writing' };
const researchIntent: Intent = { ...DEFAULT_INTENT, domain: 'research' };
```

Also update the `'always includes research discipline block'` test (lines 34-39), which asserts the literal string `'mcp_call'` that Task 7's prose edit removes. Replace:

```typescript
  it('always includes research discipline block', () => {
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('Research discipline');
    expect(ctx).toContain('Web search and fetch are provided by MCP servers');
    expect(ctx).toContain('mcp_call');
  });
```

with:

```typescript
  it('always includes research discipline block', () => {
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('Research discipline');
    expect(ctx).toContain('Web search and fetch are provided by MCP servers');
    expect(ctx).toContain('tool_search');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/services/context.test.ts`
Expected: PASS still (deleting tests doesn't break anything yet) — this step is a no-op confirmation; proceed to Step 3.

- [ ] **Step 3: Edit `server/src/services/context.ts`**

Delete lines 267-313 entirely (the `// ─── Tool subsetting` section: `SHARED`, `SCHEDULED`, `TOOL_SETS`, `getToolSubset`).

Remove the now-unused `import type Anthropic from '@anthropic-ai/sdk';` (line 1) — confirm nothing else in the file references the `Anthropic` namespace:

Run: `grep -n "Anthropic\." server/src/services/context.ts`

If that returns nothing, delete line 1.

Update the MCP connections prose block (`researchBlock`-adjacent, the literal text at line 51 inside `baseBlock`) — replace:

```
## MCP connections
GitHub, web search, and other external service integrations are provided through MCP servers configured in Settings → MCP. Before calling mcp_call, use list_connections to discover available MCP servers and their tool names — never guess a connection_id or tool name. Use test_connection to verify an MCP server is reachable before dispatching dependent work. If the user asks you to do something that requires GitHub or web search and no suitable MCP is configured, tell them which type of MCP server to add (e.g. GitHub MCP for repo/PR/issue operations, a search MCP like Brave or Exa for web research).
```

with:

```
## MCP connections
GitHub, web search, and other external service integrations are provided through MCP servers configured in Settings → MCP. Use list_connections to see what's configured, then test_connection to verify a server is reachable — this also registers its tools so tool_search can find them. After that, use tool_search to find the specific MCP tool you need (e.g. "create a github pull request") and call it directly by name. If the user asks for something that requires GitHub or web search and no suitable MCP is configured, tell them which type of MCP server to add (e.g. GitHub MCP for repo/PR/issue operations, a search MCP like Brave or Exa for web research).
```

Update `researchBlock()` (line 71) — replace:

```
Web search and fetch are provided by MCP servers (e.g. Brave, Exa, Tavily) — use list_connections to find the available search tool, then call it via mcp_call. Always read the full source after getting search results before drawing conclusions.
```

with:

```
Web search and fetch are provided by MCP servers (e.g. Brave, Exa, Tavily) — use tool_search to find the available search tool (e.g. "web search"), then call it directly by name. Always read the full source after getting search results before drawing conclusions.
```

Update the `research` domain block (line 116) — replace:

```
Use list_connections to find the configured search MCP, then mcp_call for searches. Always fetch and read the full source page after getting results — snippets alone are insufficient.
```

with:

```
Use tool_search to find the configured search MCP tool, then call it directly. Always fetch and read the full source page after getting results — snippets alone are insufficient.
```

Update `baseBlock`'s auto-approved tool lists (lines 30-31) — remove `mcp_call` from both strings and add `tool_search`:

```typescript
  const autoApproved = isCode
    ? 'invoke_claude_code, invoke_codex, generate_video, git_op add/commit, run_command, create_project, update_project, project_query, rebuild_graph, search_files, read_file, list_dir, recall, remember, forget, list_chats, read_chat, register_artifact, list_artifacts, read_artifact, list_connections, test_connection, tool_search, create_plan, resume_plan, list_plans, get_plan, get_execution_output, list_scheduled_tasks, create_scheduled_task, update_scheduled_task'
    : 'create_project, search_files, read_file, list_dir, recall, remember, forget, write_file, run_command, list_chats, read_chat, list_artifacts, read_artifact, list_connections, test_connection, tool_search';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/services/context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/services/context.ts server/tests/services/context.test.ts
git commit -m "refactor(server): remove dead getToolSubset, point system prompt at tool_search"
```

---

### Task 8: `agent.ts` — wire tool resolution, `tool_search` dispatch, MCP registry fallback, ingestion trigger

**Files:**
- Modify: `server/src/services/agent.ts:170-187` (`PARALLEL_SAFE_TOOLS`), `:722-743` (delete `mcp_call` case), `:844-896` (`list_connections`/`test_connection` cases — wire ingestion), `:1246-1247` (default case — add registry fallback), `:1306-1310` (tool resolution for the turn)
- Test: `server/tests/services/agent.test.ts` (extend existing — check current structure first)

**Interfaces:**
- Consumes: `searchTools`, `EXCLUDED_FROM_SEARCH` (Task 4), `resolveRegistryTool`, `dispatchRegistryTool`, `ingestMcpTools` (Task 3), `addSessionDiscoveredTools`, `getSessionDiscoveredTools` (Task 1).
- Produces: `resolveToolsForTurn(userId: string, sessionId: string): Anthropic.Tool[]` (new local helper in `agent.ts`).

- [ ] **Step 1: Check existing test structure**

Run: `grep -n "describe(\|^import" server/tests/services/agent.test.ts | head -30`

Use whatever test setup helpers (DB seeding, mocked Anthropic client) already exist in that file for the new tests below — match the existing pattern rather than introducing a new one.

- [ ] **Step 2: Write the failing tests**

Add to `server/tests/services/agent.test.ts` (adapt imports/setup to match the file's existing conventions found in Step 1):

```typescript
describe('tool discovery in runAgentTurn', () => {
  it('always-loaded core set includes tool_search and excludes the full static list', async () => {
    const { resolveToolsForTurn } = await import('../../src/services/agent.js');
    // Assumes resolveToolsForTurn is exported for testing; see Step 3.
    const tools = resolveToolsForTurn('user-1', 'session-with-no-discoveries');
    const names = tools.map(t => t.name);
    expect(names).toContain('tool_search');
    expect(names).toContain('delegate_to_agent');
    expect(names).not.toContain('generate_video'); // not in core, not yet discovered
  });

  it('includes a previously discovered tool on subsequent calls', async () => {
    const { getDb } = await import('../../src/db/index.js');
    const { addSessionDiscoveredTools } = await import('../../src/db/index.js');
    const { resolveToolsForTurn } = await import('../../src/services/agent.js');

    addSessionDiscoveredTools('session-with-no-discoveries', ['generate_video']);
    const tools = resolveToolsForTurn('user-1', 'session-with-no-discoveries');
    expect(tools.map(t => t.name)).toContain('generate_video');
  });
});
```

These tests require seeding a `user-1` and a `session-with-no-discoveries` row beforehand — follow whatever seeding pattern the existing tests in this file use (likely a `beforeEach`/`beforeAll` already present).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run tests/services/agent.test.ts -t "tool discovery"`
Expected: FAIL — `resolveToolsForTurn` is not exported yet.

- [ ] **Step 4: Implement the changes in `agent.ts`**

Add imports near the top (after the existing `toolDefinitions` import, line 29):

```typescript
import { searchTools, EXCLUDED_FROM_SEARCH } from './toolSearch.js';
import { resolveRegistryTool, dispatchRegistryTool, ingestMcpTools } from './toolRegistry.js';
import { addSessionDiscoveredTools, getSessionDiscoveredTools } from '../db/index.js';
```

(Note: `getDb`, `getProjectForUser`, etc. are already imported from `'../db/index.js'` at line 5 — add `addSessionDiscoveredTools, getSessionDiscoveredTools` into that existing import list instead of a new import line.)

Add the always-loaded core set and `resolveToolsForTurn`, placed near `PARALLEL_SAFE_TOOLS` (after line 187):

```typescript
const CORE_TOOLS = new Set([
  'tool_search',
  'recall',
  'remember',
  'read_file',
  'search_files',
  'list_dir',
  'write_file',
  'create_plan',
  'delegate_to_agent',
]);

export function resolveToolsForTurn(userId: string, sessionId: string): Anthropic.Tool[] {
  const core = toolDefinitions.filter(t => CORE_TOOLS.has(t.name));
  const discoveredNames = getSessionDiscoveredTools(sessionId);
  const discovered = discoveredNames
    .filter(name => !CORE_TOOLS.has(name))
    .map(name => toolDefinitions.find(t => t.name === name) ?? resolveRegistryTool(userId, name))
    .filter((t): t is Anthropic.Tool => Boolean(t));
  return [...core, ...discovered];
}
```

Replace line 1310 (`const tools = toolDefinitions;`) with:

```typescript
  const tools = resolveToolsForTurn(userId, sessionId);
```

Add `'tool_search'` to `PARALLEL_SAFE_TOOLS` (it's read-only):

```typescript
const PARALLEL_SAFE_TOOLS = new Set([
  'recall',
  'list_chats',
  'read_chat',
  'list_artifacts',
  'read_artifact',
  'list_connections',
  'test_connection',
  'search_files',
  'read_file',
  'list_dir',
  'project_query',
  'list_plans',
  'get_plan',
  'get_execution_output',
  'list_scheduled_tasks',
  'wait_for_execution',
  'tool_search',
]);
```

Delete the `case 'mcp_call': { ... }` block (lines 722-743).

Add a `case 'tool_search':` block where `mcp_call` used to be:

```typescript
      case 'tool_search': {
        const matches = searchTools(userId, toolInput.query as string);
        if (matches.length === 0) {
          result = 'No matching tools found, try rephrasing the query.';
          break;
        }
        addSessionDiscoveredTools(sessionId, matches.map(m => m.name));
        result = JSON.stringify(matches, null, 2);
        break;
      }
```

Update the `test_connection` case (lines 876-897) to trigger ingestion on success — insert the ingestion call right after the existing `listMcpTools` call inside the try block:

```typescript
      case 'test_connection': {
        const connRow = getDb()
          .prepare("SELECT id, name, type FROM connections WHERE id = ? AND user_id = ?")
          .get(toolInput.connection_id as string, userId) as { id: string; name: string; type: string } | undefined;
        if (!connRow) { result = `Error: connection ${toolInput.connection_id} not found`; break; }
        if (connRow.type !== 'mcp') {
          const cfg = getDecryptedConfig(connRow.id, userId);
          const hasKey = Object.values(cfg).some(v => v && String(v).length > 0);
          result = JSON.stringify({ id: connRow.id, name: connRow.name, type: connRow.type, status: hasKey ? 'ok' : 'error', error: hasKey ? null : 'No credentials configured' });
          break;
        }
        try {
          const cfg = getDecryptedConfig(connRow.id, userId);
          const mcpArgs = cfg.args ? JSON.parse(cfg.args) : [];
          const mcpEnv = cfg.env ? JSON.parse(cfg.env) : {};
          const tools = await listMcpTools(connRow.id, cfg.command, mcpArgs, mcpEnv);
          await ingestMcpTools(userId, connRow.id);
          result = JSON.stringify({ id: connRow.id, name: connRow.name, type: 'mcp', status: 'ok', tools: tools.map(t => ({ name: t.name, description: t.description })) });
        } catch (err) {
          result = JSON.stringify({ id: connRow.id, name: connRow.name, type: 'mcp', status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
```

Update the `default:` case (line 1246-1247) to fall back to the registry before giving up:

```typescript
      default: {
        const registryResult = await dispatchRegistryTool(userId, toolName, toolInput);
        if (registryResult !== undefined) {
          // Self-healing: the model called a registry tool that wasn't in its
          // pinned discovered set (hallucinated name or lost session state).
          // Pin it now so subsequent turns see its schema without re-searching.
          addSessionDiscoveredTools(sessionId, [toolName]);
        }
        result = registryResult ?? `Unknown tool: ${toolName}`;
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run tests/services/agent.test.ts -t "tool discovery"`
Expected: PASS

- [ ] **Step 6: Run the full existing agent test suite to check nothing else broke**

Run: `cd server && npx vitest run tests/services/agent.test.ts`
Expected: PASS — pay particular attention to any pre-existing test that exercised `mcp_call` directly; if one exists, update it to call `tool_search` then the resolved tool name instead, following the pattern from Step 2.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/agent.ts server/tests/services/agent.test.ts
git commit -m "feat(server): wire tool_search discovery flow and MCP registry fallback into agent turn loop"
```

---

### Task 9: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite**

Run: `cd server && npx vitest run`
Expected: All tests pass. If any test outside this plan's scope references `mcp_call`, `getToolSubset`, or `Intent.scope` (e.g. in `tests/tools/` for plan/pipeline step `tool_args` examples that mention `mcp_call` in a comment or fixture — check `create_plan.test.ts` and `agent_pipeline.test.ts` if present), update those references to the new `tool_search` flow.

Run: `grep -rn "mcp_call\|getToolSubset\|\.scope\b" server/src server/tests`

Confirm the only remaining hits are: the `create_plan` tool's `tool_args` description string in `definitions.ts` (which still documents `mcp` as a valid plan step `agent` type — this is the **plan-step executor type**, unrelated to the removed `mcp_call` model-facing tool, and is out of scope for this plan) and any plan-step execution code path that dispatches `agent: 'mcp'` steps (`server/src/services/agent_pipeline.ts` or wherever plan steps execute) — check whether that path calls `callMcpTool` directly (acceptable, no change needed) or routes through the now-deleted `mcp_call` tool case (would need updating to call `callMcpTool` directly too).

- [ ] **Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit any final fixups**

```bash
git add -A
git commit -m "fix(server): regression fixes for tool_search migration"
```

(Only if Step 1 or 2 required changes — skip this commit if the regression pass was clean.)
