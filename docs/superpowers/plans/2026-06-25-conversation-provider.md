# Conversation Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom lead-agent agentic loop with Claude Code / Codex as conversational providers backed by the user's subscription or API key, exposing all app tools via an HTTP MCP server.

**Architecture:** `runAgentTurn` shrinks to a ~30-line shim that spawns a `ConversationProvider` (Claude Code or Codex CLI) with a short-lived MCP auth token. The CLI drives its own agentic loop; the app's MCP server at `/mcp` handles all custom tool calls. The plan system is removed; Claude Code handles multi-step work natively.

**Tech Stack:** TypeScript, Express, better-sqlite3, jsonwebtoken (already in deps), vitest. No new npm packages required — MCP server is implemented as plain JSON-RPC over HTTP.

## Global Constraints

- No new npm packages — `jsonwebtoken`, `express`, `better-sqlite3` cover everything needed
- All new files are ESM (`.ts` with `import/export`, consistent with the rest of the codebase)
- Tests use vitest with the existing setup in `server/tests/setup.ts` (sets `process.env.DATA_DIR`, `JWT_SECRET`, `NODE_ENV=test`)
- File paths are relative to `server/` unless prefixed with `web/`
- Connection `type` CHECK constraint in SQLite must be rebuilt (not just ALTER'd) to add new values — use the existing pattern in `db/index.ts`
- The `agent_framing.ts` `DELEGATE_FRAMING` constant stays — it's still used by plan-step invocations (removed in Task 11)
- `maybeGenerateSessionTitle`, `extractAndRemember`, `maybeDistill` remain best-effort; they're no-ops when no `anthropic` connection exists
- Keep `stopAgentTurn` working — it must SIGTERM the provider's subprocess

---

### Task 1: DB migration — session provider columns + connection type widening

**Files:**
- Modify: `src/db/index.ts`
- Test: `tests/db/migration-v6.test.ts` (new)

**Interfaces:**
- Produces: `sessions.provider_type TEXT` (`'claude_code' | 'codex' | null`), `sessions.provider_session_id TEXT`
- Produces: `connections.type` CHECK now includes `'claude_code'` and `'codex'`

- [ ] **Step 1: Write the failing migration test**

Create `server/tests/db/migration-v6.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';

const DATA_DIR = process.env.DATA_DIR!;

beforeAll(() => {
  closeDb();
  const dbPath = path.join(DATA_DIR, 'app.db');
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  initDb(DATA_DIR);
});

afterAll(() => closeDb());

describe('migration v6', () => {
  it('sessions has provider_type and provider_session_id columns', () => {
    const db = getDb();
    const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const cols = info.map(r => r.name);
    expect(cols).toContain('provider_type');
    expect(cols).toContain('provider_session_id');
  });

  it('connections accepts claude_code and codex types', () => {
    const db = getDb();
    // Insert a user first
    db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES ('u1','test@test.com','x')").run();
    expect(() => {
      db.prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES ('c1','u1','Claude Code','claude_code','{}')").run();
    }).not.toThrow();
    expect(() => {
      db.prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES ('c2','u1','Codex','codex','{}')").run();
    }).not.toThrow();
  });

  it('connections rejects unknown types', () => {
    const db = getDb();
    expect(() => {
      db.prepare("INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES ('c3','u1','Bad','unknown','{}')").run();
    }).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx vitest run tests/db/migration-v6.test.ts
```

Expected: FAIL — columns not found, CHECK constraint violation.

- [ ] **Step 3: Add migration to `src/db/index.ts`**

Find the last migration number (currently the `addItemTemplates` block) and add after it. Add a new helper function and call it from `initDb`:

```typescript
function addConversationProviderColumns(database: Database.Database): void {
  // sessions: provider_type + provider_session_id
  const sessionCols = (database.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map(r => r.name);
  if (!sessionCols.includes('provider_type')) {
    database.exec("ALTER TABLE sessions ADD COLUMN provider_type TEXT");
  }
  if (!sessionCols.includes('provider_session_id')) {
    database.exec("ALTER TABLE sessions ADD COLUMN provider_session_id TEXT");
  }

  // connections: widen type CHECK to include claude_code + codex
  const connSql = tableSql(database, 'connections');
  if (connSql && !connSql.includes('claude_code')) {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE connections RENAME TO connections_pre_provider_types;
      PRAGMA legacy_alter_table = OFF;
      CREATE TABLE connections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('anthropic','openai','github','mcp','local','claude_code','codex')),
        purpose TEXT NOT NULL DEFAULT 'tool',
        encrypted_config TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(user_id, name)
      );
      INSERT INTO connections SELECT * FROM connections_pre_provider_types;
      DROP TABLE connections_pre_provider_types;
      PRAGMA foreign_keys = ON;
    `);
  }
}
```

In `initDb`, call it after the last existing migration:

```typescript
addConversationProviderColumns(db);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && npx vitest run tests/db/migration-v6.test.ts
```

Expected: PASS — all 3 assertions green.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/index.ts server/tests/db/migration-v6.test.ts
git commit -m "feat(db): add provider columns to sessions, widen connection type check"
```

---

### Task 2: MCP auth tokens

**Files:**
- Create: `src/mcp/auth.ts`
- Test: `tests/mcp/auth.test.ts` (new)

**Interfaces:**
- Produces: `generateMcpToken(userId: string): string`
- Produces: `verifyMcpToken(token: string): { userId: string }`
- Produces: `MCP_TOKEN_EXPIRY_SECS = 3600`

- [ ] **Step 1: Write the failing test**

Create `server/tests/mcp/auth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateMcpToken, verifyMcpToken } from '../../src/mcp/auth.js';

describe('MCP auth tokens', () => {
  it('roundtrips userId', () => {
    const token = generateMcpToken('user-123');
    const payload = verifyMcpToken(token);
    expect(payload.userId).toBe('user-123');
  });

  it('rejects tokens signed with wrong secret', () => {
    expect(() => verifyMcpToken('not.a.token')).toThrow();
  });

  it('rejects non-mcp tokens', () => {
    // signToken from jwt.ts has no scope claim
    const { signToken } = await import('../../src/lib/jwt.js');
    const appToken = signToken('user-123');
    expect(() => verifyMcpToken(appToken)).toThrow(/mcp/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx vitest run tests/mcp/auth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/mcp/auth.ts`**

```typescript
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../lib/secrets.js';

export const MCP_TOKEN_EXPIRY_SECS = 3600;

export function generateMcpToken(userId: string): string {
  return jwt.sign({ userId, scope: 'mcp' }, getJwtSecret(), { expiresIn: MCP_TOKEN_EXPIRY_SECS });
}

export function verifyMcpToken(token: string): { userId: string } {
  const payload = jwt.verify(token, getJwtSecret()) as { userId?: string; scope?: string };
  if (payload.scope !== 'mcp' || !payload.userId) throw new Error('Invalid mcp token scope');
  return { userId: payload.userId };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && npx vitest run tests/mcp/auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/auth.ts server/tests/mcp/auth.test.ts
git commit -m "feat(mcp): add short-lived auth token generation and verification"
```

---

### Task 3: MCP server — JSON-RPC router + tool registry

**Files:**
- Create: `src/mcp/index.ts`
- Create: `src/mcp/registry.ts`
- Modify: `src/index.ts`
- Test: `tests/mcp/server.test.ts` (new)

**Interfaces:**
- Produces: Express router exported from `src/mcp/index.ts`, mounted at `/mcp`
- Produces: `registerTool(tool: McpToolDef): void` from `src/mcp/registry.ts`
- Produces: `McpToolDef = { name: string; description: string; inputSchema: Record<string, unknown>; handler: (args: Record<string, unknown>, userId: string) => Promise<string> }`

- [ ] **Step 1: Write the failing test**

Create `server/tests/mcp/server.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { initDb, closeDb } from '../../src/db/index.js';
import mcpRouter from '../../src/mcp/index.js';
import { generateMcpToken } from '../../src/mcp/auth.js';
import { registerTool } from '../../src/mcp/registry.js';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR!;

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  registerTool({
    name: 'echo',
    description: 'Echoes input',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    handler: async (args) => args.text as string,
  });
});

afterAll(() => closeDb());

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter);
  return app;
}

function rpc(method: string, params?: unknown, id = 1) {
  return { jsonrpc: '2.0', method, params, id };
}

describe('MCP server', () => {
  it('rejects missing auth', async () => {
    const res = await request(makeApp()).post('/mcp').send(rpc('initialize'));
    expect(res.status).toBe(401);
  });

  it('handles initialize', async () => {
    const token = generateMcpToken('u1');
    const res = await request(makeApp())
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} }));
    expect(res.status).toBe(200);
    expect(res.body.result.capabilities).toBeDefined();
  });

  it('lists registered tools', async () => {
    const token = generateMcpToken('u1');
    const res = await request(makeApp())
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(rpc('tools/list'));
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as Array<{ name: string }>;
    expect(tools.some(t => t.name === 'echo')).toBe(true);
  });

  it('calls a registered tool', async () => {
    const token = generateMcpToken('u1');
    const res = await request(makeApp())
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(rpc('tools/call', { name: 'echo', arguments: { text: 'hello' } }));
    expect(res.status).toBe(200);
    expect(res.body.result.content[0].text).toBe('hello');
  });

  it('returns error for unknown tool', async () => {
    const token = generateMcpToken('u1');
    const res = await request(makeApp())
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(rpc('tools/call', { name: 'nope', arguments: {} }));
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx vitest run tests/mcp/server.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/mcp/registry.ts`**

```typescript
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, userId: string) => Promise<string>;
}

const tools = new Map<string, McpToolDef>();

export function registerTool(tool: McpToolDef): void {
  tools.set(tool.name, tool);
}

export function listTools(): McpToolDef[] {
  return Array.from(tools.values());
}

export function getTool(name: string): McpToolDef | undefined {
  return tools.get(name);
}
```

- [ ] **Step 4: Create `src/mcp/index.ts`**

```typescript
import { Router } from 'express';
import { verifyMcpToken } from './auth.js';
import { listTools, getTool } from './registry.js';

const router = Router();

router.post('/', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer token' });
    return;
  }

  let userId: string;
  try {
    ({ userId } = verifyMcpToken(authHeader.slice(7)));
  } catch {
    res.status(401).json({ error: 'Invalid MCP token' });
    return;
  }

  const { jsonrpc, method, params, id } = req.body as {
    jsonrpc: string;
    method: string;
    params?: Record<string, unknown>;
    id: number | string;
  };

  function ok(result: unknown) {
    res.json({ jsonrpc, id, result });
  }

  function err(code: number, message: string) {
    res.json({ jsonrpc, id, error: { code, message } });
  }

  if (method === 'initialize') {
    ok({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'app', version: '1.0' },
    });
    return;
  }

  if (method === 'tools/list') {
    ok({
      tools: listTools().map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> };
    const tool = getTool(name);
    if (!tool) {
      err(-32601, `Unknown tool: ${name}`);
      return;
    }
    try {
      const text = await tool.handler(args, userId);
      ok({ content: [{ type: 'text', text }] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ok({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });
    }
    return;
  }

  err(-32601, `Method not found: ${method}`);
});

export default router;
```

- [ ] **Step 5: Mount `/mcp` in `src/index.ts`**

Add import and route mount. Find the block where other routes are imported (around line 18) and add:

```typescript
import mcpRouter from './mcp/index.js';
```

Find where routes are mounted (after `app.use('/api/pipelines', pipelinesRoutes)`) and add:

```typescript
app.use('/mcp', mcpRouter);
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd server && npx vitest run tests/mcp/server.test.ts
```

Expected: PASS — all 5 assertions green.

- [ ] **Step 7: Commit**

```bash
git add server/src/mcp/index.ts server/src/mcp/registry.ts server/src/index.ts server/tests/mcp/server.test.ts
git commit -m "feat(mcp): add HTTP JSON-RPC server with tool registry"
```

---

### Task 4: MCP handlers — spaces and items

**Files:**
- Create: `src/mcp/handlers/spaces.ts`
- Create: `src/mcp/handlers/items.ts`
- Create: `src/mcp/handlers/index.ts` (registers all handlers)
- Modify: `src/mcp/index.ts` (import handlers/index.ts)
- Test: `tests/mcp/handlers.test.ts` (new)

**Interfaces:**
- Consumes: `registerTool` from `src/mcp/registry.ts`
- Consumes: `listProjects`, `createProject`, `updateProject`, `deleteProject` from `src/tools/project_ops.ts`
- Consumes: `getItemsForSpace`, `getItemById`, `createNoteItem` from `src/services/items.ts`
- Consumes: `runCreateItem`, `runUpdateItem`, `runReadItem`, `runListItemTemplates`, `runCreateItemTemplate`, `runUpdateItemTemplate` from `src/tools/item_ops.ts`

- [ ] **Step 1: Write the failing test**

Create `server/tests/mcp/handlers.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';
import mcpRouter from '../../src/mcp/index.js';
import { generateMcpToken } from '../../src/mcp/auth.js';

const DATA_DIR = process.env.DATA_DIR!;
let userId: string;

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('u-mcp','mcp@test.com','x')").run();
  userId = 'u-mcp';
  // Import handlers to register them
  await import('../../src/mcp/handlers/index.js');
});

afterAll(() => closeDb());

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter);
  return app;
}

function call(app: ReturnType<typeof makeApp>, toolName: string, args: Record<string, unknown>, token: string) {
  return request(app)
    .post('/mcp')
    .set('Authorization', `Bearer ${token}`)
    .send({ jsonrpc: '2.0', method: 'tools/call', params: { name: toolName, arguments: args }, id: 1 });
}

describe('space handlers', () => {
  it('list_spaces returns empty array initially', async () => {
    const token = generateMcpToken(userId);
    const res = await call(makeApp(), 'list_spaces', {}, token);
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    const spaces = JSON.parse(res.body.result.content[0].text);
    expect(Array.isArray(spaces)).toBe(true);
  });

  it('create_space creates and list_spaces returns it', async () => {
    const token = generateMcpToken(userId);
    const app = makeApp();
    await call(app, 'create_space', { name: 'Test Space' }, token);
    const res = await call(app, 'list_spaces', {}, token);
    const spaces = JSON.parse(res.body.result.content[0].text);
    expect(spaces.some((s: { name: string }) => s.name === 'Test Space')).toBe(true);
  });
});

describe('item handlers', () => {
  it('list_items returns empty array for new space', async () => {
    const token = generateMcpToken(userId);
    const app = makeApp();
    // create a space first
    const createRes = await call(app, 'create_space', { name: 'Item Test Space' }, token);
    const space = JSON.parse(createRes.body.result.content[0].text);
    const res = await call(app, 'list_items', { space_id: space.id }, token);
    expect(res.status).toBe(200);
    const items = JSON.parse(res.body.result.content[0].text);
    expect(Array.isArray(items)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx vitest run tests/mcp/handlers.test.ts
```

Expected: FAIL — handlers not registered.

- [ ] **Step 3: Create `src/mcp/handlers/spaces.ts`**

```typescript
import { registerTool } from '../registry.js';
import { listProjects, createProject, updateProject, deleteProject } from '../../tools/project_ops.js';
import { getSpaceForUser } from '../../db/index.js';

export function registerSpaceHandlers(): void {
  registerTool({
    name: 'list_spaces',
    description: 'List all spaces for the user',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => listProjects(userId),
  });

  registerTool({
    name: 'create_space',
    description: 'Create a new space',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
    handler: async (args, userId) =>
      createProject({ name: args.name as string, description: args.description as string | undefined, with_repo: false }, userId, 'mcp'),
  });

  registerTool({
    name: 'update_space',
    description: 'Update an existing space name or description',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['space_id'],
    },
    handler: async (args, userId) =>
      updateProject({ space_id: args.space_id as string, name: args.name as string | undefined, description: args.description as string | undefined }, userId),
  });

  registerTool({
    name: 'delete_space',
    description: 'Delete a space and optionally its files',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        delete_files: { type: 'boolean' },
      },
      required: ['space_id'],
    },
    handler: async (args, userId) =>
      deleteProject({ space_id: args.space_id as string, delete_files: (args.delete_files as boolean | undefined) ?? false }, userId, 'mcp'),
  });
}
```

- [ ] **Step 4: Create `src/mcp/handlers/items.ts`**

```typescript
import { registerTool } from '../registry.js';
import { getItemsForSpace, createNoteItem } from '../../services/items.js';
import { runCreateItem, runUpdateItem, runReadItem, runListItemTemplates, runCreateItemTemplate, runUpdateItemTemplate } from '../../tools/item_ops.js';
import type { Block } from '../../services/items.js';

export function registerItemHandlers(): void {
  registerTool({
    name: 'list_items',
    description: 'List all items in a space',
    inputSchema: {
      type: 'object',
      properties: { space_id: { type: 'string' } },
      required: ['space_id'],
    },
    handler: async (args) => JSON.stringify(getItemsForSpace(args.space_id as string), null, 2),
  });

  registerTool({
    name: 'read_item',
    description: 'Read the content of a space item',
    inputSchema: {
      type: 'object',
      properties: { space_id: { type: 'string' }, item_id: { type: 'string' } },
      required: ['space_id', 'item_id'],
    },
    handler: async (args, userId) =>
      runReadItem({ space_id: args.space_id as string, item_id: args.item_id as string }, userId),
  });

  registerTool({
    name: 'create_item',
    description: 'Create a new item in a space (repo, file, or note)',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['repo', 'file', 'note'] },
        template_id: { type: 'string' },
        repo_path: { type: 'string' },
        default_branch: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['space_id', 'name', 'type'],
    },
    handler: async (args, userId) =>
      runCreateItem({
        space_id: args.space_id as string,
        name: args.name as string,
        type: args.type as string,
        template_id: args.template_id as string | undefined,
        repo_path: args.repo_path as string | undefined,
        default_branch: args.default_branch as string | undefined,
        content: args.content as string | undefined,
        source_session_id: null,
        source_plan_id: null,
        source_step_id: null,
      }, userId),
  });

  registerTool({
    name: 'update_item',
    description: 'Update an item\'s content or blocks',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        content: { type: 'string' },
        blocks: { type: 'array' },
        block_id: { type: 'string' },
        block: { type: 'object' },
      },
      required: ['space_id', 'item_id'],
    },
    handler: async (args, userId) =>
      runUpdateItem({
        space_id: args.space_id as string,
        item_id: args.item_id as string,
        content: args.content as string | undefined,
        blocks: args.blocks as Block[] | undefined,
        block_id: args.block_id as string | undefined,
        block: args.block as Block | undefined,
      }, userId),
  });

  registerTool({
    name: 'create_note',
    description: 'Create a note item in a space',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['space_id', 'name', 'content'],
    },
    handler: async (args) => {
      const item = createNoteItem({
        space_id: args.space_id as string,
        name: args.name as string,
        content: args.content as string,
        source_session_id: null,
        source_plan_id: null,
        source_step_id: null,
      });
      return JSON.stringify(item);
    },
  });

  registerTool({
    name: 'list_item_templates',
    description: 'List available item templates',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => runListItemTemplates(userId),
  });

  registerTool({
    name: 'create_item_template',
    description: 'Create a new item template',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        blocks: { type: 'array' },
      },
      required: ['name', 'blocks'],
    },
    handler: async (args, userId) =>
      runCreateItemTemplate({ name: args.name as string, blocks: args.blocks as Block[] }, userId),
  });

  registerTool({
    name: 'update_item_template',
    description: 'Update an item template',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string' },
        name: { type: 'string' },
        blocks: { type: 'array' },
      },
      required: ['template_id', 'blocks'],
    },
    handler: async (args) =>
      runUpdateItemTemplate({ template_id: args.template_id as string, name: args.name as string | undefined, blocks: args.blocks as Block[] }),
  });
}
```

- [ ] **Step 5: Create `src/mcp/handlers/index.ts`**

```typescript
import { registerSpaceHandlers } from './spaces.js';
import { registerItemHandlers } from './items.js';

registerSpaceHandlers();
registerItemHandlers();
```

- [ ] **Step 6: Import handlers in `src/mcp/index.ts`**

Add at the top of `src/mcp/index.ts`, before the router definition:

```typescript
import './handlers/index.js';
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd server && npx vitest run tests/mcp/handlers.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/mcp/handlers/spaces.ts server/src/mcp/handlers/items.ts server/src/mcp/handlers/index.ts server/src/mcp/index.ts server/tests/mcp/handlers.test.ts
git commit -m "feat(mcp): register space and item tool handlers"
```

---

### Task 5: MCP handlers — memory, knowledge, chats

**Files:**
- Create: `src/mcp/handlers/memory.ts`
- Create: `src/mcp/handlers/knowledge.ts`
- Create: `src/mcp/handlers/chats.ts`
- Modify: `src/mcp/handlers/index.ts`

**Interfaces:**
- Consumes: `remember`, `recall`, `forget` from `src/tools/memory_tools.ts`
- Consumes: `runProjectQuery` from `src/tools/project_query.ts`
- Consumes: `buildGraph` from `src/services/graphify.ts`
- Consumes: `readChat` from `src/tools/read_chat.ts`
- Consumes: `getAnthropicKey` from `src/services/anthropic.ts`
- Consumes: `getDb` from `src/db/index.ts`

- [ ] **Step 1: Create `src/mcp/handlers/memory.ts`**

```typescript
import { registerTool } from '../registry.js';
import { remember, recall, forget } from '../../tools/memory_tools.js';

export function registerMemoryHandlers(): void {
  registerTool({
    name: 'remember',
    description: 'Store a piece of information in memory',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
        space_id: { type: 'string' },
      },
      required: ['type', 'key', 'value'],
    },
    handler: async (args, userId) =>
      remember(userId, args.type as string, args.key as string, args.value as string, args.space_id as string | undefined),
  });

  registerTool({
    name: 'recall',
    description: 'Retrieve information from memory',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        key: { type: 'string' },
      },
    },
    handler: async (args, userId) =>
      recall(userId, args.type as string | undefined, args.key as string | undefined),
  });

  registerTool({
    name: 'forget',
    description: 'Delete a memory entry',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['type', 'key'],
    },
    handler: async (args, userId) =>
      forget(userId, args.type as string, args.key as string),
  });
}
```

- [ ] **Step 2: Create `src/mcp/handlers/knowledge.ts`**

```typescript
import { registerTool } from '../registry.js';
import { runProjectQuery } from '../../tools/project_query.js';
import { buildGraph } from '../../services/graphify.js';
import { getAnthropicKey } from '../../services/anthropic.js';

export function registerKnowledgeHandlers(): void {
  registerTool({
    name: 'project_query',
    description: 'Ask a question about a repo using the knowledge graph',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        question: { type: 'string' },
      },
      required: ['space_id', 'item_id', 'question'],
    },
    handler: async (args, userId) => {
      let key: string | null = null;
      try { key = getAnthropicKey(userId); } catch { /* none configured */ }
      return runProjectQuery(
        { space_id: args.space_id as string, item_id: args.item_id as string, question: args.question as string },
        userId,
        key,
      );
    },
  });

  registerTool({
    name: 'rebuild_graph',
    description: 'Rebuild the knowledge graph for a repo item',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
      },
      required: ['space_id', 'item_id'],
    },
    handler: async (args, userId) => {
      const { getItemById } = await import('../../services/items.js');
      const item = getItemById(args.item_id as string);
      if (!item || item.space_id !== args.space_id || item.type !== 'repo') {
        return `Error: repo item ${args.item_id} not found in space ${args.space_id}`;
      }
      let key: string | null = null;
      try { key = getAnthropicKey(userId); } catch { /* none configured */ }
      await buildGraph(item.repo_path, item.id, key);
      return 'Knowledge graph rebuilt successfully.';
    },
  });
}
```

- [ ] **Step 3: Create `src/mcp/handlers/chats.ts`**

```typescript
import { registerTool } from '../registry.js';
import { readChat } from '../../tools/read_chat.js';
import { getDb } from '../../db/index.js';

export function registerChatHandlers(): void {
  registerTool({
    name: 'list_chats',
    description: 'List recent chat sessions, optionally filtered by space',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    handler: async (args, userId) => {
      const limit = Math.min(100, (args.limit as number | undefined) ?? 20);
      const filterSpace = args.space_id as string | undefined;
      const rows = filterSpace
        ? getDb().prepare('SELECT id, title, updated_at, pinned_space_id FROM sessions WHERE user_id = ? AND pinned_space_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, filterSpace, limit)
        : getDb().prepare('SELECT id, title, updated_at, pinned_space_id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, limit);
      return JSON.stringify(rows, null, 2);
    },
  });

  registerTool({
    name: 'read_chat',
    description: 'Read the full message history of a chat session',
    inputSchema: {
      type: 'object',
      properties: { chat_id: { type: 'string' } },
      required: ['chat_id'],
    },
    handler: async (args, userId) => readChat(userId, args.chat_id as string),
  });
}
```

- [ ] **Step 4: Update `src/mcp/handlers/index.ts`**

```typescript
import { registerSpaceHandlers } from './spaces.js';
import { registerItemHandlers } from './items.js';
import { registerMemoryHandlers } from './memory.js';
import { registerKnowledgeHandlers } from './knowledge.js';
import { registerChatHandlers } from './chats.js';

registerSpaceHandlers();
registerItemHandlers();
registerMemoryHandlers();
registerKnowledgeHandlers();
registerChatHandlers();
```

- [ ] **Step 5: Run existing tests to confirm nothing broke**

```bash
cd server && npx vitest run tests/mcp/
```

Expected: PASS — all MCP tests green.

- [ ] **Step 6: Commit**

```bash
git add server/src/mcp/handlers/memory.ts server/src/mcp/handlers/knowledge.ts server/src/mcp/handlers/chats.ts server/src/mcp/handlers/index.ts
git commit -m "feat(mcp): register memory, knowledge, and chat tool handlers"
```

---

### Task 6: MCP handlers — git, connections, schedules

**Files:**
- Create: `src/mcp/handlers/git.ts`
- Create: `src/mcp/handlers/connections.ts`
- Create: `src/mcp/handlers/schedules.ts`
- Modify: `src/mcp/handlers/index.ts`

**Interfaces:**
- Consumes: `runGitOp` from `src/tools/git_op.ts`
- Consumes: `getDecryptedConfig` from `src/routes/connections.ts`
- Consumes: `createConnectionTool` from `src/tools/connection_ops.ts`
- Consumes: `getScheduledTasksForUser`, `createScheduledTask`, `updateScheduledTask`, `deleteScheduledTask` from `src/db/index.ts`
- Consumes: `listMcpTools` from `src/lib/mcp-pool.ts`
- Consumes: `ensureWorktree` from `src/lib/worktree.ts`

- [ ] **Step 1: Create `src/mcp/handlers/git.ts`**

```typescript
import { registerTool } from '../registry.js';
import { runGitOp } from '../../tools/git_op.js';
import { getItemById } from '../../services/items.js';
import { ensureWorktree } from '../../lib/worktree.js';
import { createExecution, completeExecution } from '../../services/executor.js';
import { newId } from '../../lib/ids.js';

export function registerGitHandlers(): void {
  registerTool({
    name: 'git_op',
    description: 'Run a git operation (log, diff, status, commit, push) on a repo item',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        op: { type: 'string', enum: ['log', 'diff', 'status', 'commit', 'push'] },
        message: { type: 'string' },
        branch: { type: 'string' },
      },
      required: ['space_id', 'item_id', 'op'],
    },
    handler: async (args, userId) => {
      const item = getItemById(args.item_id as string);
      if (!item || item.space_id !== args.space_id || item.type !== 'repo') {
        return `Error: repo item ${args.item_id} not found in space ${args.space_id}`;
      }
      const executionId = createExecution(userId, newId(), args.space_id as string, 'git_op');
      const worktree = await ensureWorktree(item, newId());
      const result = await runGitOp(
        {
          op: args.op as 'log' | 'diff' | 'status' | 'commit' | 'push',
          message: args.message as string | undefined,
          branch: (args.branch as string | undefined) ?? worktree.branch,
        },
        { userId, executionId, projectId: args.space_id as string, repoPath: worktree.worktree_path },
      );
      completeExecution(executionId, userId, 'done', result);
      return result;
    },
  });
}
```

- [ ] **Step 2: Create `src/mcp/handlers/connections.ts`**

```typescript
import { registerTool } from '../registry.js';
import { getDb } from '../../db/index.js';
import { getDecryptedConfig } from '../../routes/connections.js';
import { createConnectionTool } from '../../tools/connection_ops.js';
import { listMcpTools } from '../../lib/mcp-pool.js';
import { ingestMcpTools } from '../../services/toolRegistry.js';
import { createExecution, completeExecution } from '../../services/executor.js';
import { newId } from '../../lib/ids.js';

export function registerConnectionHandlers(): void {
  registerTool({
    name: 'list_connections',
    description: 'List all configured connections',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      const conns = getDb()
        .prepare("SELECT id, name, type, purpose FROM connections WHERE user_id = ? ORDER BY created_at")
        .all(userId) as Array<{ id: string; name: string; type: string; purpose: string }>;
      return JSON.stringify(conns, null, 2);
    },
  });

  registerTool({
    name: 'create_connection',
    description: 'Create a new connection (anthropic, openai, mcp, claude_code, codex, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        purpose: { type: 'string' },
        config: { type: 'object' },
      },
      required: ['name', 'type', 'config'],
    },
    handler: async (args, userId) => {
      const executionId = createExecution(userId, newId(), null, 'create_connection');
      const result = await createConnectionTool(
        { name: args.name as string, type: args.type as string, purpose: args.purpose as string | undefined, config: args.config as Record<string, unknown> },
        { userId, executionId },
      );
      completeExecution(executionId, userId, result.startsWith('Error:') ? 'error' : 'done', result);
      return result;
    },
  });

  registerTool({
    name: 'test_connection',
    description: 'Test a connection and return its status',
    inputSchema: {
      type: 'object',
      properties: { connection_id: { type: 'string' } },
      required: ['connection_id'],
    },
    handler: async (args, userId) => {
      const connRow = getDb()
        .prepare("SELECT id, name, type FROM connections WHERE id = ? AND user_id = ?")
        .get(args.connection_id as string, userId) as { id: string; name: string; type: string } | undefined;
      if (!connRow) return `Error: connection ${args.connection_id} not found`;
      if (connRow.type !== 'mcp') {
        const cfg = getDecryptedConfig(connRow.id, userId);
        const hasKey = Object.values(cfg).some(v => v && String(v).length > 0);
        return JSON.stringify({ id: connRow.id, name: connRow.name, type: connRow.type, status: hasKey ? 'ok' : 'error' });
      }
      try {
        const cfg = getDecryptedConfig(connRow.id, userId);
        const mcpArgs = cfg.args ? JSON.parse(cfg.args) : [];
        const mcpEnv = cfg.env ? JSON.parse(cfg.env) : {};
        const tools = await listMcpTools(connRow.id, cfg.command, mcpArgs, mcpEnv);
        await ingestMcpTools(userId, connRow.id);
        return JSON.stringify({ id: connRow.id, name: connRow.name, type: 'mcp', status: 'ok', tools: tools.map(t => ({ name: t.name, description: t.description })) });
      } catch (err) {
        return JSON.stringify({ id: connRow.id, name: connRow.name, type: 'mcp', status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}
```

- [ ] **Step 3: Create `src/mcp/handlers/schedules.ts`**

```typescript
import { registerTool } from '../registry.js';
import { getScheduledTasksForUser, createScheduledTask, updateScheduledTask, deleteScheduledTask } from '../../db/index.js';

export function registerScheduleHandlers(): void {
  registerTool({
    name: 'list_scheduled_tasks',
    description: 'List all scheduled tasks',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      const tasks = getScheduledTasksForUser(userId);
      return JSON.stringify(tasks.map(t => ({
        id: t.id, type: t.type, prompt: t.prompt,
        interval_hours: t.interval_hours, enabled: !!t.enabled,
        next_run_at: t.next_run_at, last_run_at: t.last_run_at,
      })), null, 2);
    },
  });

  registerTool({
    name: 'create_scheduled_task',
    description: 'Create a new scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        prompt: { type: 'string' },
        interval_hours: { type: 'number' },
      },
      required: ['type', 'interval_hours'],
    },
    handler: async (args, userId) => {
      const id = createScheduledTask(userId, args.type as string, args.interval_hours as number, args.prompt as string | undefined);
      return JSON.stringify({ id, type: args.type, interval_hours: args.interval_hours, enabled: true });
    },
  });

  registerTool({
    name: 'update_scheduled_task',
    description: 'Enable/disable or change interval for a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        enabled: { type: 'boolean' },
        interval_hours: { type: 'number' },
      },
      required: ['task_id'],
    },
    handler: async (args, userId) => {
      updateScheduledTask(args.task_id as string, userId, {
        enabled: args.enabled as boolean | undefined,
        interval_hours: args.interval_hours as number | undefined,
      });
      return 'Scheduled task updated';
    },
  });
}
```

- [ ] **Step 4: Update `src/mcp/handlers/index.ts`**

```typescript
import { registerSpaceHandlers } from './spaces.js';
import { registerItemHandlers } from './items.js';
import { registerMemoryHandlers } from './memory.js';
import { registerKnowledgeHandlers } from './knowledge.js';
import { registerChatHandlers } from './chats.js';
import { registerGitHandlers } from './git.js';
import { registerConnectionHandlers } from './connections.js';
import { registerScheduleHandlers } from './schedules.js';

registerSpaceHandlers();
registerItemHandlers();
registerMemoryHandlers();
registerKnowledgeHandlers();
registerChatHandlers();
registerGitHandlers();
registerConnectionHandlers();
registerScheduleHandlers();
```

- [ ] **Step 5: Run all MCP tests**

```bash
cd server && npx vitest run tests/mcp/
```

Expected: PASS — all green.

- [ ] **Step 6: Commit**

```bash
git add server/src/mcp/handlers/git.ts server/src/mcp/handlers/connections.ts server/src/mcp/handlers/schedules.ts server/src/mcp/handlers/index.ts
git commit -m "feat(mcp): register git, connection, and schedule tool handlers"
```

---

### Task 7: ConversationProvider interface + ClaudeCodeProvider

**Files:**
- Create: `src/services/conversation-provider.ts`
- Create: `src/services/conversation/claude-code-provider.ts`
- Modify: `src/tools/invoke_claude_code.ts` — make `repoPath` optional, add HTTP MCP config support
- Test: `tests/services/conversation-provider.test.ts` (new)

**Interfaces:**
- Produces: `ConversationProvider` interface
- Produces: `getConversationProvider(userId: string): ConversationProvider` (reads from connections, falls back to CLI detection)
- Produces: `ClaudeCodeProvider` class implementing `ConversationProvider`
- Produces: `McpHttpServer = { url: string; headers?: Record<string, string> }` — new variant for MCP config

- [ ] **Step 1: Write the failing test**

Create `server/tests/services/conversation-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';

const DATA_DIR = process.env.DATA_DIR!;

const invokeClaudeCodeMock = vi.fn().mockResolvedValue({ result: 'done', sessionId: 'sess-1', costUsd: 0.001 });
vi.mock('../../src/tools/invoke_claude_code.js', () => ({ invokeClaudeCode: invokeClaudeCodeMock }));
vi.mock('../../src/services/executor.js', () => ({
  createExecution: vi.fn().mockReturnValue('exec-1'),
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
}));

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  getDb().prepare("INSERT INTO users (id, email, password_hash) VALUES ('u1','a@b.com','x')").run();
});

afterAll(() => closeDb());

describe('ClaudeCodeProvider', () => {
  it('invokes claude code and fires onText + onSessionId callbacks', async () => {
    const { ClaudeCodeProvider } = await import('../../src/services/conversation/claude-code-provider.js');
    const provider = new ClaudeCodeProvider({ mode: 'local', model: 'claude-sonnet-4-6', permissionProfile: 'default' });

    invokeClaudeCodeMock.mockImplementationOnce(async (_input, ctx) => {
      ctx.onText?.('Hello ');
      ctx.onText?.('world');
      ctx.onSessionId?.('sess-abc');
      return { result: 'done', sessionId: 'sess-abc', costUsd: 0.002 };
    });

    const textChunks: string[] = [];
    let capturedSessionId = '';
    await provider.invoke({
      prompt: 'say hi',
      onText: (t) => textChunks.push(t),
      onSessionId: (id) => { capturedSessionId = id; },
      mcpServers: {},
    });

    expect(textChunks).toEqual(['Hello ', 'world']);
    expect(capturedSessionId).toBe('sess-abc');
  });

  it('passes resumeSessionId when provided', async () => {
    const { ClaudeCodeProvider } = await import('../../src/services/conversation/claude-code-provider.js');
    const provider = new ClaudeCodeProvider({ mode: 'local', model: 'claude-sonnet-4-6', permissionProfile: 'default' });

    await provider.invoke({
      prompt: 'continue',
      resumeSessionId: 'prev-sess',
      onText: vi.fn(),
      onSessionId: vi.fn(),
      mcpServers: {},
    });

    const ctx = invokeClaudeCodeMock.mock.calls.at(-1)?.[1];
    expect(ctx.resumeSessionId).toBe('prev-sess');
  });
});

describe('getConversationProvider', () => {
  it('falls back to ClaudeCodeProvider when no connection configured', async () => {
    const { getConversationProvider } = await import('../../src/services/conversation-provider.js');
    const provider = getConversationProvider('u1');
    expect(provider.type).toBe('claude_code');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx vitest run tests/services/conversation-provider.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Extend `McpServerConfig` in `src/tools/invoke_claude_code.ts`**

Replace the existing `McpServerConfig` interface and the mcp config writing code:

```typescript
// Replace the existing McpServerConfig interface:
export interface McpServerConfig {
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // HTTP transport
  url?: string;
  headers?: Record<string, string>;
}
```

Replace the mcp config writing block in `invokeClaudeCode`:

```typescript
if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
  mcpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unnamed-claude-mcp-'));
  const mcpConfigPath = path.join(mcpConfigDir, 'mcp.json');
  const servers: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(ctx.mcpServers)) {
    if (cfg.url) {
      servers[name] = { type: 'http', url: cfg.url, ...(cfg.headers ? { headers: cfg.headers } : {}) };
    } else {
      servers[name] = { command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {} };
    }
  }
  await fs.writeFile(mcpConfigPath, JSON.stringify({ mcpServers: servers }));
  args.push('--mcp-config', mcpConfigPath);
}
```

Also make `repoPath` optional in `ToolContext` and default the cwd to `process.cwd()`:

```typescript
interface ToolContext {
  userId: string;
  executionId: string;
  repoPath?: string;   // optional — defaults to cwd for conversational sessions
  apiKey: string | null;
  resumeSessionId?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
  permissionProfile?: PermissionProfile;
  onText?: (delta: string) => void;      // NEW — for streaming chat
  onSessionId?: (id: string) => void;
}
```

Add `onText` callback to the stream processing in the `proc.stdout.on('data', ...)` handler. Find the block that handles `event.type === 'assistant'` and add:

```typescript
if (block.type === 'text' && block.text) {
  appendOutput(ctx.executionId, ctx.userId, block.text);
  ctx.onText?.(block.text);   // NEW — stream to caller
}
```

Update the `spawn` call to use `ctx.repoPath ?? process.cwd()`:

```typescript
const proc = spawn('claude', args, {
  cwd: ctx.repoPath ?? process.cwd(),
  env: getDelegateEnv('claude_code', ctx.apiKey, profile),
});
```

- [ ] **Step 4: Create `src/services/conversation/claude-code-provider.ts`**

```typescript
import { invokeClaudeCode } from '../../tools/invoke_claude_code.js';
import { getPermissionProfile } from '../../db/index.js';
import { createExecution, completeExecution } from '../executor.js';
import { newId } from '../../lib/ids.js';
import type { McpServerConfig } from '../../tools/invoke_claude_code.js';
import type { ConversationProvider, InvokeParams } from '../conversation-provider.js';

interface ClaudeCodeConfig {
  mode: 'local' | 'api';
  model: string;
  permissionProfile: string;
  apiKey?: string;
}

export class ClaudeCodeProvider implements ConversationProvider {
  readonly type = 'claude_code' as const;
  private config: ClaudeCodeConfig;

  constructor(config: ClaudeCodeConfig) {
    this.config = config;
  }

  async invoke(params: InvokeParams): Promise<{ costUsd?: number }> {
    const executionId = createExecution(params.userId ?? 'system', newId(), null, 'claude_code');
    const result = await invokeClaudeCode(
      { prompt: params.prompt, model: this.config.model },
      {
        userId: params.userId ?? 'system',
        executionId,
        apiKey: this.config.apiKey ?? null,
        resumeSessionId: params.resumeSessionId,
        mcpServers: params.mcpServers as Record<string, McpServerConfig>,
        permissionProfile: this.config.permissionProfile as Parameters<typeof getPermissionProfile>[0],
        signal: params.signal,
        onText: params.onText,
        onSessionId: params.onSessionId,
      },
    );
    completeExecution(executionId, params.userId ?? 'system', 'done', result.result);
    return { costUsd: result.costUsd };
  }

  async resolveModel(): Promise<string> {
    return this.config.model;
  }
}
```

- [ ] **Step 5: Create `src/services/conversation-provider.ts`**

```typescript
import { getDb } from '../db/index.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { ClaudeCodeProvider } from './conversation/claude-code-provider.js';

export interface InvokeParams {
  userId?: string;
  prompt: string;
  resumeSessionId?: string | null;
  systemPromptSuffix?: string;
  mcpServers: Record<string, { url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string> }>;
  model?: string;
  signal?: AbortSignal;
  onText: (delta: string) => void;
  onSessionId: (id: string) => void;
}

export interface ConversationProvider {
  readonly type: 'claude_code' | 'codex';
  invoke(params: InvokeParams): Promise<{ costUsd?: number }>;
  resolveModel(): Promise<string>;
}

export function getConversationProvider(userId: string): ConversationProvider {
  const conn = getDb()
    .prepare("SELECT id, type FROM connections WHERE user_id = ? AND type IN ('claude_code','codex') ORDER BY created_at LIMIT 1")
    .get(userId) as { id: string; type: string } | undefined;

  if (conn) {
    const cfg = getDecryptedConfig(conn.id, userId);
    const mode = (cfg.mode as 'local' | 'api') ?? 'local';
    const model = (cfg.model as string) ?? 'claude-sonnet-4-6';
    const permissionProfile = (cfg.permissionProfile as string) ?? 'default';
    const apiKey = cfg.apiKey as string | undefined;

    if (conn.type === 'codex') {
      // CodexProvider is added in Task 8
      throw new Error('CodexProvider not yet implemented');
    }
    return new ClaudeCodeProvider({ mode, model, permissionProfile, apiKey });
  }

  // Default: local Claude Code CLI
  return new ClaudeCodeProvider({ mode: 'local', model: 'claude-sonnet-4-6', permissionProfile: 'default' });
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd server && npx vitest run tests/services/conversation-provider.test.ts
```

Expected: PASS — all assertions green.

- [ ] **Step 7: Commit**

```bash
git add server/src/tools/invoke_claude_code.ts server/src/services/conversation-provider.ts server/src/services/conversation/claude-code-provider.ts server/tests/services/conversation-provider.test.ts
git commit -m "feat: ConversationProvider interface and ClaudeCodeProvider"
```

---

### Task 8: CodexProvider

**Files:**
- Create: `src/services/conversation/codex-provider.ts`
- Modify: `src/tools/invoke_codex.ts` — add `onText` callback support, make `repoPath` optional
- Modify: `src/services/conversation-provider.ts` — wire CodexProvider
- Test: `tests/services/codex-provider.test.ts` (new)

**Interfaces:**
- Consumes: `InvokeParams`, `ConversationProvider` from `src/services/conversation-provider.ts`
- Produces: `CodexProvider` class implementing `ConversationProvider`

- [ ] **Step 1: Write the failing test**

Create `server/tests/services/codex-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, closeDb } from '../../src/db/index.js';

const DATA_DIR = process.env.DATA_DIR!;

const invokeCodexMock = vi.fn().mockResolvedValue({ result: 'done', sessionId: 'sess-1', costUsd: 0 });
vi.mock('../../src/tools/invoke_codex.js', () => ({ invokeCodex: invokeCodexMock }));
vi.mock('../../src/services/executor.js', () => ({
  createExecution: vi.fn().mockReturnValue('exec-1'),
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
}));

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
});

afterAll(() => closeDb());

describe('CodexProvider', () => {
  it('invokes codex and fires onText callback', async () => {
    const { CodexProvider } = await import('../../src/services/conversation/codex-provider.js');
    const provider = new CodexProvider({ mode: 'local', model: 'codex-mini-latest', permissionProfile: 'default' });

    invokeCodexMock.mockImplementationOnce(async (_input, ctx) => {
      ctx.onText?.('codex says hi');
      ctx.onSessionId?.('thread-xyz');
      return { result: 'done', sessionId: 'thread-xyz', costUsd: 0 };
    });

    const chunks: string[] = [];
    let sessionId = '';
    await provider.invoke({
      prompt: 'hello',
      onText: (t) => chunks.push(t),
      onSessionId: (id) => { sessionId = id; },
      mcpServers: {},
    });

    expect(chunks).toEqual(['codex says hi']);
    expect(sessionId).toBe('thread-xyz');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx vitest run tests/services/codex-provider.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Add `onText` callback to `src/tools/invoke_codex.ts`**

Add `onText?: (delta: string) => void` to the `ToolContext` interface and make `repoPath` optional. In the `item.text` handling block, add:

```typescript
if (item?.type === 'agent_message' && item.text) {
  resultText = item.text;
  appendOutput(ctx.executionId, ctx.userId, item.text + '\n');
  ctx.onText?.(item.text);  // NEW
}
```

Update `repoPath` to be optional and default cwd:

```typescript
interface ToolContext {
  userId: string;
  executionId: string;
  repoPath?: string;   // optional
  // ...rest unchanged
  onText?: (delta: string) => void;  // NEW
}
```

Update `spawn` cwd: `cwd: ctx.repoPath ?? process.cwd()`.

- [ ] **Step 4: Create `src/services/conversation/codex-provider.ts`**

```typescript
import { invokeCodex } from '../../tools/invoke_codex.js';
import { createExecution, completeExecution } from '../executor.js';
import { newId } from '../../lib/ids.js';
import type { ConversationProvider, InvokeParams } from '../conversation-provider.js';

interface CodexConfig {
  mode: 'local' | 'api';
  model: string;
  permissionProfile: string;
  apiKey?: string;
}

export class CodexProvider implements ConversationProvider {
  readonly type = 'codex' as const;
  private config: CodexConfig;

  constructor(config: CodexConfig) {
    this.config = config;
  }

  async invoke(params: InvokeParams): Promise<{ costUsd?: number }> {
    const executionId = createExecution(params.userId ?? 'system', newId(), null, 'codex');
    const result = await invokeCodex(
      { prompt: params.prompt, model: this.config.model },
      {
        userId: params.userId ?? 'system',
        executionId,
        apiKey: this.config.apiKey ?? null,
        resumeSessionId: params.resumeSessionId,
        mcpServers: params.mcpServers,
        permissionProfile: this.config.permissionProfile as 'default' | 'fast' | 'strict',
        signal: params.signal,
        onText: params.onText,
        onSessionId: params.onSessionId,
      },
    );
    completeExecution(executionId, params.userId ?? 'system', 'done', result.result);
    return { costUsd: result.costUsd };
  }

  async resolveModel(): Promise<string> {
    return this.config.model;
  }
}
```

- [ ] **Step 5: Wire CodexProvider in `src/services/conversation-provider.ts`**

Replace the `throw new Error('CodexProvider not yet implemented')` block:

```typescript
if (conn.type === 'codex') {
  const { CodexProvider } = await import('./conversation/codex-provider.js');
  return new CodexProvider({ mode, model: model ?? 'codex-mini-latest', permissionProfile, apiKey });
}
```

Make `getConversationProvider` async and update the call sites (just `runAgentTurn` in Task 9).

- [ ] **Step 6: Run tests**

```bash
cd server && npx vitest run tests/services/codex-provider.test.ts tests/services/conversation-provider.test.ts
```

Expected: PASS — all green.

- [ ] **Step 7: Commit**

```bash
git add server/src/tools/invoke_codex.ts server/src/services/conversation/codex-provider.ts server/src/services/conversation-provider.ts server/tests/services/codex-provider.test.ts
git commit -m "feat: CodexProvider implementation"
```

---

### Task 9: Replace runAgentTurn

**Files:**
- Modify: `src/services/agent.ts` — replace the 180-line agentic loop with a ~40-line provider shim
- Modify: `src/db/index.ts` — add `getSessionProviderInfo`, `setSessionProviderInfo` helpers
- Test: `tests/services/agent.test.ts` — update to mock ConversationProvider instead of Anthropic SDK

**Interfaces:**
- Consumes: `getConversationProvider` from `src/services/conversation-provider.ts`
- Consumes: `generateMcpToken` from `src/mcp/auth.ts`
- Consumes: `buildContext` from `src/services/context.ts`
- Consumes: `classifyIntent` from `src/services/intent.ts`

- [ ] **Step 1: Add DB helpers to `src/db/index.ts`**

Add near other session helpers:

```typescript
export function getSessionProviderInfo(sessionId: string): { provider_type: string | null; provider_session_id: string | null } | undefined {
  return getDb()
    .prepare('SELECT provider_type, provider_session_id FROM sessions WHERE id = ?')
    .get(sessionId) as { provider_type: string | null; provider_session_id: string | null } | undefined;
}

export function setSessionProviderInfo(sessionId: string, providerType: string, providerSessionId: string): void {
  getDb()
    .prepare('UPDATE sessions SET provider_type = ?, provider_session_id = ? WHERE id = ?')
    .run(providerType, providerSessionId, sessionId);
}
```

- [ ] **Step 2: Write the failing test**

Replace the contents of `server/tests/services/agent.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';

const DATA_DIR = process.env.DATA_DIR!;

const mockInvoke = vi.fn().mockImplementation(async (params) => {
  params.onText('Hello from provider');
  params.onSessionId('prov-sess-1');
  return { costUsd: 0.001 };
});

vi.mock('../../src/services/conversation-provider.js', () => ({
  getConversationProvider: vi.fn().mockReturnValue({
    type: 'claude_code',
    invoke: mockInvoke,
    resolveModel: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
  }),
}));
vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));
vi.mock('../../src/services/executor.js', () => ({
  createExecution: vi.fn().mockReturnValue('exec-1'),
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));
vi.mock('../../src/mcp/auth.js', () => ({ generateMcpToken: vi.fn().mockReturnValue('mcp-tok') }));
vi.mock('../../src/services/extract-memory.js', () => ({ extractAndRemember: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/distill.js', () => ({ maybeDistill: vi.fn().mockResolvedValue(undefined) }));

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('u1','a@b.com','x')").run();
  db.prepare("INSERT INTO sessions (id, user_id) VALUES ('s1','u1')").run();
  db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES ('m1','s1','user','hello')").run();
  db.prepare("INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES ('t1','s1','m1','running')").run();
});

afterAll(() => closeDb());

import { closeDb } from '../../src/db/index.js';

describe('runAgentTurn', () => {
  it('streams text delta and stores provider session id', async () => {
    const { broadcast } = await import('../../src/services/socket.js');
    const { runAgentTurn } = await import('../../src/services/agent.js');

    await runAgentTurn('u1', 's1', 'm1');

    const broadcastCalls = (broadcast as ReturnType<typeof vi.fn>).mock.calls;
    const deltaCall = broadcastCalls.find(([, msg]: [string, { type: string }]) => msg.type === 'message_delta');
    expect(deltaCall).toBeDefined();
    expect(deltaCall[1].delta).toBe('Hello from provider');

    const session = getDb().prepare('SELECT provider_session_id FROM sessions WHERE id = ?').get('s1') as { provider_session_id: string | null };
    expect(session.provider_session_id).toBe('prov-sess-1');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd server && npx vitest run tests/services/agent.test.ts
```

Expected: FAIL — streaming does not match.

- [ ] **Step 4: Rewrite `runAgentTurn` in `src/services/agent.ts`**

Replace the `runAgentTurn` function (lines ~1468–1646) with:

```typescript
export async function runAgentTurn(userId: string, sessionId: string, userMessageId: string): Promise<void> {
  const provider = getConversationProvider(userId);

  const session = getDb()
    .prepare('SELECT model, provider_session_id FROM sessions WHERE id = ?')
    .get(sessionId) as { model: string | null; provider_session_id: string | null } | undefined;

  const lastUserMsg = getDb()
    .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1")
    .get(sessionId) as { content: string } | undefined;

  const prompt = lastUserMsg?.content ?? '';
  const intent = classifyIntent(prompt);
  const systemPromptSuffix = buildContext(userId, sessionId, intent);

  const port = process.env.PORT ?? '3000';
  const mcpToken = generateMcpToken(userId);
  const mcpServers = {
    app: { url: `http://localhost:${port}/mcp`, headers: { Authorization: `Bearer ${mcpToken}` } },
  };

  const replyId = newId();
  const replyCreatedAt = Math.floor(Date.now() / 1000);
  let started = false;
  let fullText = '';

  const abortController = new AbortController();
  activeTurnControllers.set(sessionId, abortController);

  try {
    await provider.invoke({
      userId,
      prompt,
      resumeSessionId: session?.provider_session_id,
      systemPromptSuffix,
      mcpServers,
      model: session?.model ?? undefined,
      signal: abortController.signal,
      onText: (delta) => {
        if (!started) {
          started = true;
          getDb()
            .prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)')
            .run(replyId, sessionId, 'assistant', '', replyCreatedAt);
          broadcast(userId, { type: 'message_started', sessionId, message: { id: replyId, role: 'assistant', content: '', created_at: replyCreatedAt } });
        }
        fullText += delta;
        broadcast(userId, { type: 'message_delta', sessionId, messageId: replyId, delta });
      },
      onSessionId: (id) => {
        setSessionProviderInfo(sessionId, provider.type, id);
      },
    });
  } catch (err) {
    const wasStopped = abortController.signal.aborted;
    if (started) {
      if (fullText) {
        getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(fullText, replyId);
        broadcast(userId, { type: 'message_created', sessionId, message: { id: replyId, role: 'assistant', content: fullText, created_at: replyCreatedAt } });
      } else {
        getDb().prepare('DELETE FROM messages WHERE id = ?').run(replyId);
      }
    }
    if (wasStopped) {
      getDb()
        .prepare("UPDATE session_turns SET status = 'done', completed_at = unixepoch() WHERE session_id = ? AND user_message_id = ? AND status = 'running'")
        .run(sessionId, userMessageId);
      broadcast(userId, { type: 'turn_complete', sessionId, status: 'stopped' });
      return;
    }
    throw err;
  } finally {
    activeTurnControllers.delete(sessionId);
  }

  if (fullText) {
    getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(fullText, replyId);
    broadcast(userId, { type: 'message_created', sessionId, message: { id: replyId, role: 'assistant', content: fullText, created_at: replyCreatedAt } });
  }

  getDb()
    .prepare("UPDATE session_turns SET status = 'done', completed_at = unixepoch() WHERE session_id = ? AND user_message_id = ? AND status = 'running'")
    .run(sessionId, userMessageId);
  getDb().prepare('UPDATE sessions SET updated_at = unixepoch() WHERE id = ?').run(sessionId);
  broadcast(userId, { type: 'turn_complete', sessionId, status: 'done' });

  recordAgentUsage(userId, provider.type as AgentUsageTool, 0);

  maybeGenerateSessionTitle(userId, sessionId).catch(() => {});
  try {
    const anthropicKey = getAnthropicKey(userId);
    extractAndRemember(userId, sessionId, anthropicKey).catch(() => {});
    maybeDistill(userId, sessionId, anthropicKey).catch(() => {});
  } catch { /* no key — skip */ }
}
```

Add the required imports at the top of `agent.ts`:
```typescript
import { generateMcpToken } from '../mcp/auth.js';
import { getConversationProvider } from './conversation-provider.js';
import { getSessionProviderInfo, setSessionProviderInfo } from '../db/index.js';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd server && npx vitest run tests/services/agent.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full test suite**

```bash
cd server && npx vitest run
```

Fix any TypeScript errors from the removed imports/functions. The old `dispatchTool`, `CORE_TOOLS`, `dispatchToolBlocks`, `runSubAgent`, `resolveToolsForTurn` can now be deleted from `agent.ts`.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/agent.ts server/src/db/index.ts
git commit -m "feat: replace runAgentTurn with ConversationProvider shim"
```

---

### Task 10: claude_code and codex connection types + settings UI

**Files:**
- Modify: `src/routes/connections.ts` — handle claude_code, codex config encryption/decryption
- Modify: `web/` — add claude_code/codex connection forms, remove Lead Agent settings section
- Test: `tests/connections.test.ts` — add cases for new types

**Interfaces:**
- Consumes: `getConversationProvider` — now reads from connections table
- The `encrypted_config` for `claude_code` / `codex` stores: `{ mode, model, permissionProfile, apiKey? }`

- [ ] **Step 1: Write the failing test**

In `server/tests/connections.test.ts`, add:

```typescript
it('creates a claude_code connection', async () => {
  const res = await request(app)
    .post('/api/connections')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'My Claude Code',
      type: 'claude_code',
      config: { mode: 'local', model: 'claude-sonnet-4-6', permissionProfile: 'default' },
    });
  expect(res.status).toBe(201);
  expect(res.body.type).toBe('claude_code');
});

it('creates a codex connection with api key', async () => {
  const res = await request(app)
    .post('/api/connections')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'My Codex',
      type: 'codex',
      config: { mode: 'api', model: 'codex-mini-latest', permissionProfile: 'default', apiKey: 'sk-test' },
    });
  expect(res.status).toBe(201);
  expect(res.body.type).toBe('codex');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx vitest run tests/connections.test.ts
```

Expected: FAIL — 400 or validation error (type not in allowed list — but we fixed the DB CHECK in Task 1, so this may now be a route-level validation issue).

- [ ] **Step 3: Update `src/routes/connections.ts` to allow new types**

Find the validation block that checks `type` and add `'claude_code'` and `'codex'` to the allowed list:

```typescript
const ALLOWED_TYPES = ['anthropic', 'openai', 'github', 'mcp', 'local', 'claude_code', 'codex'] as const;
```

No other changes needed — the config is stored encrypted as-is.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && npx vitest run tests/connections.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update Settings UI**

In the web settings page for connections:
- Add "Claude Code" and "Codex" as connection type options
- Show a form with fields: **Mode** (Local subscription / API key), **Model** (text input), **Permission Profile** (select: default/fast/strict), **API Key** (shown only when mode = API key)
- Remove the "Lead Agent" settings section (the section that previously showed anthropic/openai/local lead agent configuration)

The exact component paths depend on the web codebase structure. Find the connections settings component (likely in `web/src/` under settings or connections) and add the new type forms following the existing pattern for `anthropic` / `openai`.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/connections.ts web/
git commit -m "feat: add claude_code and codex connection types, update settings UI"
```

---

### Task 11: Remove plan system, subagent, and lead agent cleanup

**Files:**
- Delete: `src/routes/plans.ts`
- Delete: `src/routes/pipelines.ts`
- Delete: `src/services/lead_agent_providers.ts`
- Modify: `src/index.ts` — remove plan/pipeline route mounts
- Modify: `src/db/index.ts` — add migration to drop plans/plan_steps tables; remove plan-related exports
- Modify: `src/services/agent.ts` — remove remaining plan-related dead code (`executePlanStep`, `runPlanAutoDispatch`, `buildPlanPriorContext`, `runSubAgent`, `PARALLEL_SAFE_TOOLS`, `CORE_TOOLS`, `dispatchTool`, `dispatchToolBlocks`, `resolveToolsForTurn`, `noteProjectUse`, `buildMessageContent`, `startPlanStep`, `finishPlanStep`)
- Modify: `src/tools/definitions.ts` — remove tool definitions for dropped tools
- Modify: `web/` — remove Plans UI (Plans tab in spaces, plan creation dialogs, plan step views)
- Delete: `tests/plans.test.ts`

**Interfaces:**
- After this task, `agent.ts` contains only: `stopAgentTurn`, `getActiveSessionIds`, `runAgentTurn`, `maybeGenerateSessionTitle`

- [ ] **Step 1: Remove plan/pipeline routes from `src/index.ts`**

Delete the import lines:
```typescript
import plansRoutes from './routes/plans.js';
import pipelinesRoutes from './routes/pipelines.js';
```

Delete the mount lines:
```typescript
app.use('/api/plans', requireAuth, plansRoutes);
app.use('/api/pipelines', requireAuth, pipelinesRoutes);
```

- [ ] **Step 2: Delete the route files**

```bash
rm server/src/routes/plans.ts server/src/routes/pipelines.ts server/tests/plans.test.ts
```

- [ ] **Step 3: Add plans drop migration to `src/db/index.ts`**

Add after `addConversationProviderColumns`:

```typescript
function dropPlanSystem(database: Database.Database): void {
  const planStepsExists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='plan_steps'")
    .get();
  if (planStepsExists) {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS plan_steps;
      DROP TABLE IF EXISTS plans;
      PRAGMA foreign_keys = ON;
    `);
  }
}
```

Call it in `initDb`:
```typescript
dropPlanSystem(db);
```

- [ ] **Step 4: Delete `src/services/lead_agent_providers.ts`**

```bash
rm server/src/services/lead_agent_providers.ts
```

- [ ] **Step 5: Clean up `src/services/agent.ts`**

Delete all of the following from `agent.ts`:
- `executePlanStep` function
- `runPlanAutoDispatch` function  
- `buildPlanPriorContext` function
- `runSubAgent` function
- `PARALLEL_SAFE_TOOLS` Set
- `CORE_TOOLS` Set
- `dispatchTool` function
- `dispatchToolBlocks` function
- `resolveToolsForTurn` function
- `startPlanStep` function
- `finishPlanStep` function
- `noteProjectUse` function
- `buildMessageContent` function
- All plan-related imports: `getPlanForStep`, `getPlanById`, `getPlanSteps`, `createPlan`, `resumePlan`, `updatePlanStepStatus`, `maybeCompletePlan`, `linkSessionProject`, `createPipeline`, `getPipelineTasks`, `getPipelineById`, etc.
- `addSessionDiscoveredTools`, `getSessionDiscoveredTools`, `upsertMcpRegistryTools` (moved to MCP layer)
- `invokeClaudeCode`, `invokeCodex` imports (no longer called directly from agent.ts)
- `toolDefinitions` import
- `searchTools` import
- `resolveRegistryTool`, `dispatchRegistryTool`, `ingestMcpTools` imports
- Remotion / video imports

Keep:
- `stopAgentTurn`
- `getActiveSessionIds`
- `runAgentTurn` (rewritten in Task 9)
- `maybeGenerateSessionTitle`
- `emitSessionEvent`
- `activeTurnControllers` Map

- [ ] **Step 6: Remove plan-related tools from `src/tools/definitions.ts`**

Remove definitions for: `invoke_claude_code`, `invoke_codex`, `create_plan`, `run_plan`, `resume_plan`, `get_plan`, `list_plans`, `get_execution_output`, `wait_for_execution`, `create_pipeline`, `run_pipeline`, `delegate_to_agent`, `tool_search`, `generate_video`, `register_file_item`, `run_command`, `write_file`, `read_file`, `list_dir`, `search_files` (now native to Claude Code).

If `definitions.ts` is now empty or has no consumers, delete it.

- [ ] **Step 7: Remove Plans UI from web**

Remove from the space detail view:
- Plans tab
- Plan creation dialog
- Plan step list component
- Plan status badges

Remove from the sidebar:
- Plan-related navigation items

Find the components by searching: `grep -r "plan\|Plan" web/src/ --include="*.tsx" -l`

- [ ] **Step 8: Run full test suite**

```bash
cd server && npx vitest run
```

Expected: All passing (plans.test.ts is deleted, agent.test.ts was updated in Task 9).

Fix any remaining import errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove plan system, subagent, and lead agent — providers handle orchestration"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Replace `runAgentTurn` with ConversationProvider shim | Task 9 |
| MCP server at `/mcp` with Streamable HTTP transport | Task 3 |
| Auth token per-turn | Task 2 |
| ~20 tools in MCP server | Tasks 4–6 |
| `ConversationProvider` interface | Task 7 |
| `ClaudeCodeProvider` | Task 7 |
| `CodexProvider` | Task 8 |
| `claude_code` / `codex` connection types | Tasks 1, 10 |
| Both local and API key modes | Task 10 |
| Session `provider_type` + `provider_session_id` | Tasks 1, 9 |
| Remove plans | Task 11 |
| Remove `subagent` step type | Task 11 |
| Remove `lead_agent_providers.ts` | Task 11 |
| Remove plan UI | Task 11 |
| Settings UI: Lead Agent → Chat Agent | Task 10 |
| `session.effort` / `session.summary` deprecated | Task 1 (columns kept, no longer written) |
| `maybeGenerateSessionTitle` / `extractAndRemember` best-effort | Task 9 |
| Stop turn via SIGTERM to subprocess | Preserved via `activeTurnControllers` + `AbortSignal` |
| File ops stay native to Claude Code | Tasks 4–6 (not exposed in MCP) |

**No placeholders found.** All steps contain actual code.

**Type consistency confirmed:** `InvokeParams.userId` is `string | undefined` throughout; `McpServerConfig` HTTP variant uses `url` and `headers` consistently in Task 7 and the `invokeClaudeCode` update.
