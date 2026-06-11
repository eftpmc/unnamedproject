# Core Server + Agent Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/server` package — Express API, SQLite data model, WebSocket, and the full lead-agent runtime with tool-use, execution streaming, and approval gate.

**Architecture:** A Node.js/TypeScript Express server is the source of truth. The lead agent runs as an Anthropic tool-use loop triggered by POST /threads/:id/messages. Sub-agent tool executors spawn background processes (Claude Code, Codex) or call external APIs (GitHub, MCP), stream output back via WebSocket, and pause for user approval on destructive actions. Graphify indexes workspace repos into a knowledge graph queried before each agent turn.

**Tech Stack:** Node.js 20+, TypeScript 5, Express 4, better-sqlite3, ws, @anthropic-ai/sdk, @octokit/rest, simple-git, vitest, supertest, bcrypt, jsonwebtoken, nanoid

---

## File Map

```
server/
  src/
    index.ts                  — Express app + WebSocket server, env validation
    db/
      index.ts                — SQLite connection, schema init, migration guard
    routes/
      auth.ts                 — POST /auth/register, POST /auth/login
      connections.ts          — GET/POST/DELETE /connections
      workspaces.ts           — GET/POST/DELETE /workspaces
      threads.ts              — GET/POST /threads
      messages.ts             — GET /threads/:id/messages, POST /threads/:id/messages
      executions.ts           — GET /executions/:id, POST approve/reject
    middleware/
      auth.ts                 — JWT verify, attaches req.userId
    services/
      socket.ts               — WebSocket server, broadcast helpers, client registry
      memory.ts               — User memory CRUD (remember/recall)
      graphify.ts             — Graphify subprocess: index workspace, query graph
      executor.ts             — Execution lifecycle: create, stream output, complete
      agent.ts                — Lead agent: Anthropic tool-use loop, workspace routing
    tools/
      definitions.ts          — Anthropic tool definitions array (all 8 tools)
      invoke_claude_code.ts   — Spawn claude CLI, stream output
      invoke_codex.ts         — Spawn codex CLI, stream output
      github_api.ts           — Octokit wrapper, read free / write needs approval
      mcp_call.ts             — MCP server call via stdio or SSE transport
      git_op.ts               — simple-git wrapper, read free / write needs approval
      workspace_query.ts      — Query Graphify graph for a workspace
      memory_tools.ts         — remember + recall implementations
    lib/
      crypto.ts               — AES-256-GCM encrypt/decrypt for connection configs
      jwt.ts                  — sign + verify JWT
      ids.ts                  — nanoid wrapper
      approval.ts             — Approval event emitter: pause execution until approved/rejected
  tests/
    auth.test.ts
    connections.test.ts
    workspaces.test.ts
    threads.test.ts
    messages.test.ts
    executions.test.ts
    services/
      memory.test.ts
      graphify.test.ts
      executor.test.ts
    tools/
      git_op.test.ts
      github_api.test.ts
      invoke_claude_code.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
  .env.example
```

---

## Task 1: Project Bootstrap

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/.env.example`
- Create: `server/src/index.ts`

- [x] **Step 1: Create server/package.json**

```json
{
  "name": "unnamedproject-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@octokit/rest": "^21.0.0",
    "bcrypt": "^5.1.1",
    "better-sqlite3": "^11.0.0",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "nanoid": "^5.0.7",
    "simple-git": "^3.27.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/better-sqlite3": "^7.6.11",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.0.0",
    "@types/supertest": "^6.0.2",
    "@types/ws": "^8.5.12",
    "supertest": "^7.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [x] **Step 2: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [x] **Step 3: Create server/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
```

- [x] **Step 4: Create server/tests/setup.ts**

```typescript
import { beforeAll, afterAll } from 'vitest';
import { closeDb } from '../src/db/index.js';

process.env.JWT_SECRET = 'test-secret-32-chars-long-enough!!';
process.env.DATA_DIR = '/tmp/unnamedproject-test';
process.env.NODE_ENV = 'test';

afterAll(() => {
  closeDb();
});
```

- [x] **Step 5: Create server/.env.example**

```
PORT=3000
DATA_DIR=./data
JWT_SECRET=change-me-must-be-at-least-32-chars
ALLOW_REGISTRATION=
NODE_ENV=
```

- [x] **Step 6: Create server/src/index.ts**

```typescript
import express from 'express';
import { createServer } from 'http';
import { initDb } from './db/index.js';
import { initSocket } from './services/socket.js';
import authRoutes from './routes/auth.js';
import connectionsRoutes from './routes/connections.js';
import workspacesRoutes from './routes/workspaces.js';
import threadsRoutes from './routes/threads.js';
import messagesRoutes from './routes/messages.js';
import executionsRoutes from './routes/executions.js';

const PORT = process.env.PORT ?? '3000';
const JWT_SECRET = process.env.JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV;

if (!JWT_SECRET && NODE_ENV !== 'test') {
  console.warn('WARNING: JWT_SECRET is not set. Set it in production.');
}

initDb();

const app = express();
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/connections', connectionsRoutes);
app.use('/workspaces', workspacesRoutes);
app.use('/threads', threadsRoutes);
app.use('/threads', messagesRoutes);
app.use('/executions', executionsRoutes);

const server = createServer(app);
initSocket(server);

if (NODE_ENV !== 'test') {
  server.listen(parseInt(PORT), () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export { app, server };
```

- [x] **Step 7: Install dependencies**

```bash
cd server && npm install
```

Expected: node_modules created, no errors.

- [x] **Step 8: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors (some "cannot find module" errors are fine until files exist).

- [x] **Step 9: Commit**

```bash
git add server/
git commit -m "feat: bootstrap server package"
```

---

## Task 2: Database Schema

**Files:**
- Create: `server/src/db/index.ts`
- Create: `server/src/lib/ids.ts`

- [x] **Step 1: Create server/src/lib/ids.ts**

```typescript
import { nanoid } from 'nanoid';

export const newId = () => nanoid(21);
```

- [x] **Step 2: Write the failing test**

```typescript
// tests/db.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { getDb, initDb } from '../src/db/index.js';
import fs from 'fs';

describe('database schema', () => {
  beforeAll(() => {
    fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
    initDb();
  });

  it('creates all tables', () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('users');
    expect(names).toContain('connections');
    expect(names).toContain('workspaces');
    expect(names).toContain('threads');
    expect(names).toContain('messages');
    expect(names).toContain('executions');
    expect(names).toContain('approvals');
    expect(names).toContain('user_memory');
  });
});
```

- [x] **Step 3: Run test to verify it fails**

```bash
cd server && npm test -- tests/db.test.ts
```

Expected: FAIL — "Cannot find module '../src/db/index.js'"

- [x] **Step 4: Create server/src/db/index.ts**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database;

export function initDb(): void {
  const dataDir = process.env.DATA_DIR ?? './data';
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema();
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function closeDb(): void {
  db?.close();
}

function applySchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      hashed_password TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('anthropic','openai','github','mcp')),
      encrypted_config TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      repo_path TEXT,
      enabled_connection_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
      tool TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','done','error','awaiting_approval')),
      output_log TEXT NOT NULL DEFAULT '',
      result TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      resolved_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, key)
    );
  `);
}
```

- [x] **Step 5: Run test to verify it passes**

```bash
cd server && npm test -- tests/db.test.ts
```

Expected: PASS

- [x] **Step 6: Commit**

```bash
git add server/src/db/ server/src/lib/ids.ts server/tests/
git commit -m "feat: database schema + ids"
```

---

## Task 3: Crypto + JWT Libs

**Files:**
- Create: `server/src/lib/crypto.ts`
- Create: `server/src/lib/jwt.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/lib/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../src/lib/crypto.js';

describe('crypto', () => {
  it('roundtrips plaintext through encrypt/decrypt', () => {
    const key = '0'.repeat(64); // 32-byte hex key
    const plain = JSON.stringify({ apiKey: 'sk-test-123' });
    const ciphertext = encrypt(plain, key);
    expect(ciphertext).not.toBe(plain);
    expect(decrypt(ciphertext, key)).toBe(plain);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const key = '0'.repeat(64);
    const plain = 'same-plaintext';
    expect(encrypt(plain, key)).not.toBe(encrypt(plain, key));
  });
});
```

```typescript
// tests/lib/jwt.test.ts
import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../../src/lib/jwt.js';

describe('jwt', () => {
  it('roundtrips a userId', () => {
    const token = signToken('user-123');
    const payload = verifyToken(token);
    expect(payload.userId).toBe('user-123');
  });

  it('throws on tampered token', () => {
    const token = signToken('user-123') + 'tampered';
    expect(() => verifyToken(token)).toThrow();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test -- tests/lib/
```

Expected: FAIL

- [x] **Step 3: Create server/src/lib/crypto.ts**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// key must be 64 hex chars (32 bytes)
export function encrypt(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
}
```

- [x] **Step 4: Create server/src/lib/jwt.ts**

```typescript
import jwt from 'jsonwebtoken';

const secret = () => process.env.JWT_SECRET ?? 'dev-secret-not-for-production';

export function signToken(userId: string): string {
  return jwt.sign({ userId }, secret(), { expiresIn: '30d' });
}

export function verifyToken(token: string): { userId: string } {
  return jwt.verify(token, secret()) as { userId: string };
}
```

- [x] **Step 5: Run tests to verify they pass**

```bash
cd server && npm test -- tests/lib/
```

Expected: PASS

- [x] **Step 6: Commit**

```bash
git add server/src/lib/crypto.ts server/src/lib/jwt.ts server/tests/lib/
git commit -m "feat: crypto + jwt helpers"
```

---

## Task 4: Auth Routes + Middleware

**Files:**
- Create: `server/src/middleware/auth.ts`
- Create: `server/src/routes/auth.ts`
- Create: `server/tests/auth.test.ts`

- [x] **Step 1: Write failing test**

```typescript
// tests/auth.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
});

describe('POST /auth/register', () => {
  it('creates first user', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
  });

  it('rejects second user when ALLOW_REGISTRATION unset', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'other@example.com', password: 'password123' });
    expect(res.status).toBe(403);
  });
});

describe('POST /auth/login', () => {
  it('returns token on valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- tests/auth.test.ts
```

Expected: FAIL

- [x] **Step 3: Create server/src/middleware/auth.ts**

```typescript
import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';

export interface AuthedRequest extends Request {
  userId: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    (req as AuthedRequest).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

- [x] **Step 4: Create server/src/routes/auth.ts**

```typescript
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { signToken } from '../lib/jwt.js';

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'email and password required' });
    return;
  }

  const db = getDb();
  const userCount = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;

  if (userCount > 0 && process.env.ALLOW_REGISTRATION !== 'true') {
    res.status(403).json({ error: 'Registration closed' });
    return;
  }

  const hashed = await bcrypt.hash(password, 12);
  const id = newId();

  try {
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)').run(id, email, hashed);
  } catch {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  res.status(201).json({ token: signToken(id) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'email and password required' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT id, hashed_password FROM users WHERE email = ?').get(email) as
    | { id: string; hashed_password: string }
    | undefined;

  if (!user || !(await bcrypt.compare(password, user.hashed_password))) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  res.json({ token: signToken(user.id) });
});

export default router;
```

- [x] **Step 5: Run test to verify it passes**

```bash
cd server && npm test -- tests/auth.test.ts
```

Expected: PASS

- [x] **Step 6: Commit**

```bash
git add server/src/routes/auth.ts server/src/middleware/auth.ts server/tests/auth.test.ts
git commit -m "feat: auth register + login + JWT middleware"
```

---

## Task 5: Connections CRUD

**Files:**
- Create: `server/src/routes/connections.ts`
- Create: `server/tests/connections.test.ts`

Connection configs are encrypted with a per-server key derived from `JWT_SECRET`. The key is the first 32 bytes (64 hex chars) of `SHA-256(JWT_SECRET)`.

- [x] **Step 1: Add deriveKey to crypto.ts**

Open `server/src/lib/crypto.ts` and add at the bottom:

```typescript
import { createHash } from 'crypto';

export function deriveKey(): string {
  const secret = process.env.JWT_SECRET ?? 'dev-secret-not-for-production';
  return createHash('sha256').update(secret).digest('hex');
}
```

- [x] **Step 2: Write failing test**

```typescript
// tests/connections.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';

let token: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `conn-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('connections', () => {
  let connectionId: string;

  it('creates a connection', async () => {
    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My Anthropic Key', type: 'anthropic', config: { apiKey: 'sk-test' } });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    connectionId = res.body.id;
  });

  it('lists connections (config not exposed)', async () => {
    const res = await request(app)
      .get('/connections')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].config).toBeUndefined();
  });

  it('deletes a connection', async () => {
    const res = await request(app)
      .delete(`/connections/${connectionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

```bash
cd server && npm test -- tests/connections.test.ts
```

Expected: FAIL

- [x] **Step 4: Create server/src/routes/connections.ts**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { Request } from 'express';

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ['anthropic', 'openai', 'github', 'mcp'] as const;

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, name, type, created_at FROM connections WHERE user_id = ? ORDER BY created_at')
    .all(userId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { name, type, config } = req.body as { name?: string; type?: string; config?: unknown };
  if (!name || !type || !config) {
    res.status(400).json({ error: 'name, type, config required' });
    return;
  }
  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    return;
  }
  const id = newId();
  const encrypted = encrypt(JSON.stringify(config), deriveKey());
  try {
    getDb()
      .prepare('INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)')
      .run(id, userId, name, type, encrypted);
  } catch {
    res.status(409).json({ error: 'Connection name already exists' });
    return;
  }
  res.status(201).json({ id });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as AuthedRequest;
  const result = getDb()
    .prepare('DELETE FROM connections WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).send();
});

export function getDecryptedConfig(connectionId: string): Record<string, string> {
  const row = getDb()
    .prepare('SELECT encrypted_config FROM connections WHERE id = ?')
    .get(connectionId) as { encrypted_config: string } | undefined;
  if (!row) throw new Error(`Connection ${connectionId} not found`);
  return JSON.parse(decrypt(row.encrypted_config, deriveKey()));
}

export default router;
```

- [x] **Step 5: Run test to verify it passes**

```bash
cd server && npm test -- tests/connections.test.ts
```

Expected: PASS

- [x] **Step 6: Commit**

```bash
git add server/src/routes/connections.ts server/tests/connections.test.ts server/src/lib/crypto.ts
git commit -m "feat: connections CRUD with encrypted config"
```

---

## Task 6: Workspaces CRUD

**Files:**
- Create: `server/src/routes/workspaces.ts`
- Create: `server/tests/workspaces.test.ts`

- [x] **Step 1: Write failing test**

```typescript
// tests/workspaces.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';

let token: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `ws-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('workspaces', () => {
  let wsId: string;

  it('creates a workspace', async () => {
    const res = await request(app)
      .post('/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'api', description: 'My API project', enabled_connection_ids: [] });
    expect(res.status).toBe(201);
    wsId = res.body.id;
  });

  it('lists workspaces', async () => {
    const res = await request(app)
      .get('/workspaces')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('api');
  });

  it('deletes a workspace', async () => {
    const res = await request(app)
      .delete(`/workspaces/${wsId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- tests/workspaces.test.ts
```

Expected: FAIL

- [x] **Step 3: Create server/src/routes/workspaces.ts**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids, created_at FROM workspaces WHERE user_id = ? ORDER BY name')
    .all(userId) as any[];
  res.json(rows.map(r => ({ ...r, enabled_connection_ids: JSON.parse(r.enabled_connection_ids) })));
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { name, description, repo_path, enabled_connection_ids = [] } = req.body as {
    name?: string; description?: string; repo_path?: string; enabled_connection_ids?: string[];
  };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  const id = newId();
  try {
    getDb()
      .prepare('INSERT INTO workspaces (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(id, userId, name, description ?? null, repo_path ?? null, JSON.stringify(enabled_connection_ids));
  } catch {
    res.status(409).json({ error: 'Workspace name already exists' });
    return;
  }
  res.status(201).json({ id });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as AuthedRequest;
  const result = getDb()
    .prepare('DELETE FROM workspaces WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(204).send();
});

export default router;
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd server && npm test -- tests/workspaces.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/routes/workspaces.ts server/tests/workspaces.test.ts
git commit -m "feat: workspaces CRUD"
```

---

## Task 7: Threads CRUD

**Files:**
- Create: `server/src/routes/threads.ts`
- Create: `server/tests/threads.test.ts`

- [x] **Step 1: Write failing test**

```typescript
// tests/threads.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';

let token: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `th-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
});

describe('threads', () => {
  let threadId: string;

  it('creates a thread', async () => {
    const res = await request(app)
      .post('/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Fix login bug' });
    expect(res.status).toBe(201);
    threadId = res.body.id;
  });

  it('lists threads ordered by updated_at desc', async () => {
    const res = await request(app)
      .get('/threads')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(threadId);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- tests/threads.test.ts
```

Expected: FAIL

- [x] **Step 3: Create server/src/routes/threads.ts**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, title, created_at, updated_at FROM threads WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { title } = req.body as { title?: string };
  const id = newId();
  getDb()
    .prepare('INSERT INTO threads (id, user_id, title) VALUES (?,?,?)')
    .run(id, userId, title ?? null);
  res.status(201).json({ id });
});

export default router;
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd server && npm test -- tests/threads.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/routes/threads.ts server/tests/threads.test.ts
git commit -m "feat: threads CRUD"
```

---

## Task 8: WebSocket Service

**Files:**
- Create: `server/src/services/socket.ts`

The WebSocket server authenticates clients via a `?token=` query param on upgrade. It maintains a registry of `userId → Set<WebSocket>` to broadcast user-specific events.

- [x] **Step 1: Create server/src/services/socket.ts**

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../lib/jwt.js';

type UserId = string;

const clients = new Map<UserId, Set<WebSocket>>();
let wss: WebSocketServer;

export function initSocket(server: Server): void {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) { ws.close(1008, 'Missing token'); return; }

    let userId: string;
    try {
      userId = verifyToken(token).userId;
    } catch {
      ws.close(1008, 'Invalid token');
      return;
    }

    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId)!.add(ws);

    ws.on('close', () => {
      clients.get(userId)?.delete(ws);
      if (clients.get(userId)?.size === 0) clients.delete(userId);
    });
  });
}

export function broadcast(userId: string, event: Record<string, unknown>): void {
  const payload = JSON.stringify(event);
  clients.get(userId)?.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}
```

- [x] **Step 2: Verify server starts without errors**

```bash
cd server && npm run dev &
sleep 2 && curl -s http://localhost:3000/threads -H "Authorization: Bearer bad" | grep -q "Invalid token" && echo "OK" || echo "FAIL"
kill %1
```

Expected: OK

- [x] **Step 3: Commit**

```bash
git add server/src/services/socket.ts
git commit -m "feat: WebSocket service with JWT auth + broadcast"
```

---

## Task 9: User Memory Service

**Files:**
- Create: `server/src/services/memory.ts`
- Create: `server/tests/services/memory.test.ts`

- [x] **Step 1: Write failing test**

```typescript
// tests/services/memory.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { rememberFact, recallFact, recallAll } from '../../src/services/memory.js';
import { newId } from '../../src/lib/ids.js';

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `mem-${userId}@test.com`, 'x');
});

describe('memory', () => {
  it('stores and recalls a fact', () => {
    rememberFact(userId, 'preferred_model', 'claude-opus-4-8');
    expect(recallFact(userId, 'preferred_model')).toBe('claude-opus-4-8');
  });

  it('updates an existing key', () => {
    rememberFact(userId, 'preferred_model', 'claude-sonnet-4-6');
    expect(recallFact(userId, 'preferred_model')).toBe('claude-sonnet-4-6');
  });

  it('returns null for missing key', () => {
    expect(recallFact(userId, 'nonexistent')).toBeNull();
  });

  it('returns all facts for a user', () => {
    rememberFact(userId, 'timezone', 'America/New_York');
    const all = recallAll(userId);
    expect(all).toHaveProperty('preferred_model');
    expect(all).toHaveProperty('timezone');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- tests/services/memory.test.ts
```

Expected: FAIL

- [x] **Step 3: Create server/src/services/memory.ts**

```typescript
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export function rememberFact(userId: string, key: string, value: string): void {
  const existing = getDb()
    .prepare('SELECT id FROM user_memory WHERE user_id = ? AND key = ?')
    .get(userId, key);
  if (existing) {
    getDb()
      .prepare('UPDATE user_memory SET value = ?, updated_at = unixepoch() WHERE user_id = ? AND key = ?')
      .run(value, userId, key);
  } else {
    getDb()
      .prepare('INSERT INTO user_memory (id, user_id, key, value) VALUES (?,?,?,?)')
      .run(newId(), userId, key, value);
  }
}

export function recallFact(userId: string, key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM user_memory WHERE user_id = ? AND key = ?')
    .get(userId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function recallAll(userId: string): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT key, value FROM user_memory WHERE user_id = ?')
    .all(userId) as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd server && npm test -- tests/services/memory.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/services/memory.ts server/tests/services/memory.test.ts
git commit -m "feat: user memory service (remember/recall)"
```

---

## Task 10: Graphify Integration

**Files:**
- Create: `server/src/services/graphify.ts`
- Create: `server/tests/services/graphify.test.ts`

Graphify is a Python CLI tool. The server spawns it as a subprocess. Two operations: `index` (build the graph for a workspace repo) and `query` (ask a question against the graph).

- [x] **Step 1: Install Graphify system dependency (document in .env.example)**

Add to `server/.env.example`:

```
# System dependencies: Python 3.10+, graphify (pip install graphify)
```

- [x] **Step 2: Write failing test**

```typescript
// tests/services/graphify.test.ts
import { describe, it, expect, vi } from 'vitest';
import { queryGraph } from '../../src/services/graphify.js';

// Mock the subprocess — we test the interface, not the Python tool
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn((ev, cb) => { if (ev === 'data') cb(Buffer.from('auth.ts: handles JWT verification')); }) },
    stderr: { on: vi.fn() },
    on: vi.fn((ev, cb) => { if (ev === 'close') cb(0); }),
  })),
}));

describe('graphify', () => {
  it('returns query result from subprocess stdout', async () => {
    const result = await queryGraph('/tmp/repo', 'What handles authentication?');
    expect(result).toContain('auth.ts');
  });
});
```

- [x] **Step 3: Run test to verify it fails**

```bash
cd server && npm test -- tests/services/graphify.test.ts
```

Expected: FAIL

- [x] **Step 4: Create server/src/services/graphify.ts**

```typescript
import { spawn } from 'child_process';
import path from 'path';

export function indexWorkspace(repoPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'graphify', 'index', repoPath], {
      cwd: repoPath,
      env: process.env,
    });
    proc.stderr.on('data', (d: Buffer) => console.error('[graphify index]', d.toString()));
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`graphify index exited with code ${code}`));
    });
  });
}

export function queryGraph(repoPath: string, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'graphify', 'query', '--repo', repoPath, '--q', question], {
      env: process.env,
    });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => console.error('[graphify query]', d.toString()));
    proc.on('close', code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`graphify query exited with code ${code}`));
    });
  });
}
```

- [x] **Step 5: Run test to verify it passes**

```bash
cd server && npm test -- tests/services/graphify.test.ts
```

Expected: PASS

- [x] **Step 6: Commit**

```bash
git add server/src/services/graphify.ts server/tests/services/graphify.test.ts server/.env.example
git commit -m "feat: graphify subprocess wrapper (index + query)"
```

---

## Task 11: Approval Gate

**Files:**
- Create: `server/src/lib/approval.ts`

The approval gate is an EventEmitter that lets a running tool executor pause and wait for a user decision. The executor calls `waitForApproval(approvalId)` which returns a Promise. The approve/reject route resolves it by emitting an event.

- [x] **Step 1: Create server/src/lib/approval.ts**

```typescript
import { EventEmitter } from 'events';

const emitter = new EventEmitter();

export function waitForApproval(approvalId: string): Promise<'approved' | 'rejected'> {
  return new Promise(resolve => {
    emitter.once(`approval:${approvalId}`, resolve);
  });
}

export function resolveApproval(approvalId: string, decision: 'approved' | 'rejected'): void {
  emitter.emit(`approval:${approvalId}`, decision);
}
```

- [x] **Step 2: Write and run test**

```typescript
// tests/lib/approval.test.ts
import { describe, it, expect } from 'vitest';
import { waitForApproval, resolveApproval } from '../../src/lib/approval.js';

describe('approval gate', () => {
  it('resolves with approved', async () => {
    const id = 'test-approval-1';
    setTimeout(() => resolveApproval(id, 'approved'), 10);
    const result = await waitForApproval(id);
    expect(result).toBe('approved');
  });

  it('resolves with rejected', async () => {
    const id = 'test-approval-2';
    setTimeout(() => resolveApproval(id, 'rejected'), 10);
    const result = await waitForApproval(id);
    expect(result).toBe('rejected');
  });
});
```

```bash
cd server && npm test -- tests/lib/approval.test.ts
```

Expected: PASS

- [x] **Step 3: Commit**

```bash
git add server/src/lib/approval.ts server/tests/lib/approval.test.ts
git commit -m "feat: approval gate event emitter"
```

---

## Task 12: Executor Service

**Files:**
- Create: `server/src/services/executor.ts`
- Create: `server/tests/services/executor.test.ts`

The executor manages execution lifecycle: creates the DB record, updates status, appends output chunks, broadcasts via WebSocket, and handles the approval pause/resume flow.

- [x] **Step 1: Write failing test**

```typescript
// tests/services/executor.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { createExecution, appendOutput, completeExecution, failExecution } from '../../src/services/executor.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));

const userId = newId();
let messageId: string;
let workspaceId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `exec-${userId}@test.com`, 'x');
  const threadId = newId();
  db.prepare('INSERT INTO threads (id, user_id) VALUES (?,?)').run(threadId, userId);
  messageId = newId();
  db.prepare('INSERT INTO messages (id, thread_id, role, content) VALUES (?,?,?,?)').run(messageId, threadId, 'user', 'hello');
  workspaceId = newId();
  db.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?,?,?)').run(workspaceId, userId, 'test-ws');
});

describe('executor', () => {
  it('creates an execution and transitions through lifecycle', () => {
    const id = createExecution(userId, messageId, workspaceId, 'git_op');
    expect(getDb().prepare('SELECT status FROM executions WHERE id = ?').get(id)).toMatchObject({ status: 'running' });

    appendOutput(id, userId, 'line 1\n');
    const row = getDb().prepare('SELECT output_log FROM executions WHERE id = ?').get(id) as { output_log: string };
    expect(row.output_log).toContain('line 1');

    completeExecution(id, userId, 'done', 'finished ok');
    expect(getDb().prepare('SELECT status FROM executions WHERE id = ?').get(id)).toMatchObject({ status: 'done' });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- tests/services/executor.test.ts
```

Expected: FAIL

- [x] **Step 3: Create server/src/services/executor.ts**

```typescript
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { broadcast } from './socket.js';
import { waitForApproval } from '../lib/approval.js';

export function createExecution(
  userId: string,
  messageId: string,
  workspaceId: string,
  tool: string
): string {
  const id = newId();
  getDb()
    .prepare('INSERT INTO executions (id, message_id, workspace_id, tool, status) VALUES (?,?,?,?,?)')
    .run(id, messageId, workspaceId, tool, 'running');
  broadcast(userId, { type: 'execution_update', executionId: id, status: 'running', tool });
  return id;
}

export function appendOutput(executionId: string, userId: string, chunk: string): void {
  getDb()
    .prepare('UPDATE executions SET output_log = output_log || ? WHERE id = ?')
    .run(chunk, executionId);
  broadcast(userId, { type: 'execution_update', executionId, chunk });
}

export function completeExecution(
  executionId: string,
  userId: string,
  status: 'done' | 'error',
  result: string
): void {
  getDb()
    .prepare('UPDATE executions SET status = ?, result = ?, completed_at = unixepoch() WHERE id = ?')
    .run(status, result, executionId);
  broadcast(userId, { type: 'execution_update', executionId, status, result });
}

export async function requestApproval(
  executionId: string,
  userId: string,
  action: string,
  payload: Record<string, unknown>
): Promise<'approved' | 'rejected'> {
  const approvalId = newId();
  getDb()
    .prepare('INSERT INTO approvals (id, execution_id, action, payload) VALUES (?,?,?,?)')
    .run(approvalId, executionId, action, JSON.stringify(payload));
  getDb()
    .prepare("UPDATE executions SET status = 'awaiting_approval' WHERE id = ?")
    .run(executionId);
  broadcast(userId, {
    type: 'approval_requested',
    executionId,
    approvalId,
    action,
    payload,
  });
  const decision = await waitForApproval(approvalId);
  getDb()
    .prepare('UPDATE approvals SET status = ?, resolved_at = unixepoch() WHERE id = ?')
    .run(decision, approvalId);
  if (decision === 'approved') {
    getDb()
      .prepare("UPDATE executions SET status = 'running' WHERE id = ?")
      .run(executionId);
  }
  broadcast(userId, { type: 'execution_update', executionId, status: decision === 'approved' ? 'running' : 'rejected' });
  return decision;
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd server && npm test -- tests/services/executor.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/services/executor.ts server/tests/services/executor.test.ts
git commit -m "feat: executor service — lifecycle, output streaming, approval gate"
```

---

## Task 13: Tool Implementations

**Files:**
- Create: `server/src/tools/git_op.ts`
- Create: `server/src/tools/github_api.ts`
- Create: `server/src/tools/invoke_claude_code.ts`
- Create: `server/src/tools/invoke_codex.ts`
- Create: `server/src/tools/mcp_call.ts`
- Create: `server/src/tools/workspace_query.ts`
- Create: `server/src/tools/memory_tools.ts`

Each tool receives `(input, context)` where `context = { userId, executionId, workspaceId, getConfig }`.

- [x] **Step 1: Write failing test for git_op**

```typescript
// tests/tools/git_op.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runGitOp } from '../../src/tools/git_op.js';

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    log: vi.fn().mockResolvedValue({ all: [{ hash: 'abc123', message: 'initial commit' }] }),
    diff: vi.fn().mockResolvedValue('--- a/file.ts\n+++ b/file.ts\n'),
    status: vi.fn().mockResolvedValue({ files: [] }),
    commit: vi.fn().mockResolvedValue({ commit: 'abc123' }),
  })),
}));

vi.mock('../../src/services/executor.js', () => ({
  requestApproval: vi.fn().mockResolvedValue('approved'),
  appendOutput: vi.fn(),
}));

const ctx = { userId: 'u1', executionId: 'e1', workspaceId: 'w1', repoPath: '/tmp/repo' };

describe('git_op', () => {
  it('runs read op (log) without approval', async () => {
    const result = await runGitOp({ op: 'log' }, ctx);
    expect(result).toContain('initial commit');
  });

  it('runs write op (commit) after approval', async () => {
    const result = await runGitOp({ op: 'commit', message: 'fix: auth bug' }, ctx);
    expect(result).toContain('committed');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- tests/tools/git_op.test.ts
```

Expected: FAIL

- [x] **Step 3: Create server/src/tools/git_op.ts**

```typescript
import simpleGit from 'simple-git';
import { requestApproval, appendOutput } from '../services/executor.js';

interface GitOpInput {
  op: 'log' | 'diff' | 'status' | 'commit' | 'push';
  message?: string;
  branch?: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  workspaceId: string;
  repoPath: string;
}

const WRITE_OPS = new Set(['commit', 'push']);

export async function runGitOp(input: GitOpInput, ctx: ToolContext): Promise<string> {
  const git = simpleGit(ctx.repoPath);

  if (WRITE_OPS.has(input.op)) {
    const decision = await requestApproval(ctx.executionId, ctx.userId, `git ${input.op}`, input);
    if (decision === 'rejected') return `User rejected git ${input.op}`;
  }

  switch (input.op) {
    case 'log': {
      const log = await git.log({ maxCount: 20 });
      return log.all.map(c => `${c.hash.slice(0, 7)} ${c.message}`).join('\n');
    }
    case 'diff': {
      return await git.diff();
    }
    case 'status': {
      const s = await git.status();
      return JSON.stringify(s.files);
    }
    case 'commit': {
      if (!input.message) return 'Error: commit message required';
      await git.commit(input.message);
      return `committed: ${input.message}`;
    }
    case 'push': {
      await git.push();
      return 'pushed';
    }
    default:
      return 'Unknown git op';
  }
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd server && npm test -- tests/tools/git_op.test.ts
```

Expected: PASS

- [x] **Step 5: Create server/src/tools/github_api.ts**

```typescript
import { Octokit } from '@octokit/rest';
import { requestApproval } from '../services/executor.js';

interface GithubInput {
  op: 'list_repos' | 'get_repo' | 'list_issues' | 'get_issue' | 'create_issue_comment';
  owner?: string;
  repo?: string;
  issue_number?: number;
  comment_body?: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  token: string;
}

const WRITE_OPS = new Set(['create_issue_comment']);

export async function runGithubApi(input: GithubInput, ctx: ToolContext): Promise<string> {
  if (WRITE_OPS.has(input.op)) {
    const decision = await requestApproval(ctx.executionId, ctx.userId, `github ${input.op}`, input);
    if (decision === 'rejected') return `User rejected github ${input.op}`;
  }

  const octokit = new Octokit({ auth: ctx.token });

  switch (input.op) {
    case 'list_repos': {
      const { data } = await octokit.repos.listForAuthenticatedUser({ per_page: 30 });
      return data.map(r => `${r.full_name} — ${r.description ?? ''}`).join('\n');
    }
    case 'get_repo': {
      const { data } = await octokit.repos.get({ owner: input.owner!, repo: input.repo! });
      return JSON.stringify({ name: data.full_name, stars: data.stargazers_count, default_branch: data.default_branch });
    }
    case 'list_issues': {
      const { data } = await octokit.issues.listForRepo({ owner: input.owner!, repo: input.repo!, state: 'open', per_page: 20 });
      return data.map(i => `#${i.number} ${i.title}`).join('\n');
    }
    case 'get_issue': {
      const { data } = await octokit.issues.get({ owner: input.owner!, repo: input.repo!, issue_number: input.issue_number! });
      return `#${data.number} ${data.title}\n\n${data.body ?? ''}`;
    }
    case 'create_issue_comment': {
      await octokit.issues.createComment({ owner: input.owner!, repo: input.repo!, issue_number: input.issue_number!, body: input.comment_body! });
      return `Comment posted on #${input.issue_number}`;
    }
    default:
      return 'Unknown github op';
  }
}
```

- [x] **Step 6: Create server/src/tools/invoke_claude_code.ts**

```typescript
import { spawn } from 'child_process';
import { appendOutput, completeExecution } from '../services/executor.js';

interface ClaudeCodeInput {
  prompt: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string;
}

export function invokeClaudeCode(input: ClaudeCodeInput, ctx: ToolContext): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print', input.prompt], {
      cwd: ctx.repoPath,
      env: { ...process.env, ANTHROPIC_API_KEY: ctx.apiKey },
    });

    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      appendOutput(ctx.executionId, ctx.userId, text);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      appendOutput(ctx.executionId, ctx.userId, chunk.toString());
    });
    proc.on('close', code => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`claude exited with code ${code}`));
    });
  });
}
```

- [x] **Step 7: Create server/src/tools/invoke_codex.ts**

```typescript
import { spawn } from 'child_process';
import { appendOutput } from '../services/executor.js';

interface CodexInput {
  prompt: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string;
}

export function invokeCodex(input: CodexInput, ctx: ToolContext): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('codex', ['--quiet', input.prompt], {
      cwd: ctx.repoPath,
      env: { ...process.env, OPENAI_API_KEY: ctx.apiKey },
    });

    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      appendOutput(ctx.executionId, ctx.userId, text);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      appendOutput(ctx.executionId, ctx.userId, chunk.toString());
    });
    proc.on('close', code => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`codex exited with code ${code}`));
    });
  });
}
```

- [x] **Step 8: Create server/src/tools/mcp_call.ts**

```typescript
import { spawn } from 'child_process';

interface McpInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface ToolContext {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function callMcp(input: McpInput, ctx: ToolContext): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ctx.command, ctx.args ?? [], {
      env: { ...process.env, ...ctx.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: input.tool_name, arguments: input.tool_input },
    });

    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => console.error('[mcp]', d.toString()));

    proc.on('close', () => {
      try {
        const lines = out.trim().split('\n');
        for (const line of lines) {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            resolve(JSON.stringify(msg.result));
            return;
          }
        }
        resolve(out.trim());
      } catch {
        resolve(out.trim());
      }
    });

    proc.stdin.write(request + '\n');
    proc.stdin.end();
  });
}
```

- [x] **Step 9: Create server/src/tools/workspace_query.ts**

```typescript
import { queryGraph } from '../services/graphify.js';
import { getDb } from '../db/index.js';

interface WorkspaceQueryInput {
  workspace_id: string;
  question: string;
}

export async function runWorkspaceQuery(input: WorkspaceQueryInput): Promise<string> {
  const ws = getDb()
    .prepare('SELECT repo_path FROM workspaces WHERE id = ?')
    .get(input.workspace_id) as { repo_path: string | null } | undefined;

  if (!ws?.repo_path) {
    return 'Workspace has no repo path configured.';
  }

  return await queryGraph(ws.repo_path, input.question);
}
```

- [x] **Step 10: Create server/src/tools/memory_tools.ts**

```typescript
import { rememberFact, recallFact, recallAll } from '../services/memory.js';

export function remember(userId: string, key: string, value: string): string {
  rememberFact(userId, key, value);
  return `Remembered: ${key} = ${value}`;
}

export function recall(userId: string, key: string | null): string {
  if (key) {
    const value = recallFact(userId, key);
    return value ? `${key}: ${value}` : `No memory for key: ${key}`;
  }
  const all = recallAll(userId);
  const entries = Object.entries(all);
  if (entries.length === 0) return 'No memories stored.';
  return entries.map(([k, v]) => `${k}: ${v}`).join('\n');
}
```

- [x] **Step 11: Commit**

```bash
git add server/src/tools/ server/tests/tools/
git commit -m "feat: tool implementations (git, github, claude code, codex, mcp, workspace query, memory)"
```

---

## Task 14: Tool Definitions (Anthropic Schema)

**Files:**
- Create: `server/src/tools/definitions.ts`

- [x] **Step 1: Create server/src/tools/definitions.ts**

```typescript
import type Anthropic from '@anthropic-ai/sdk';

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'invoke_claude_code',
    description: 'Spawn Claude Code CLI in a workspace repo to write, edit, or analyze code.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'ID of the workspace to work in' },
        prompt: { type: 'string', description: 'The task to give Claude Code' },
      },
      required: ['workspace_id', 'prompt'],
    },
  },
  {
    name: 'invoke_codex',
    description: 'Spawn Codex CLI in a workspace repo to write, edit, or analyze code.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'ID of the workspace to work in' },
        prompt: { type: 'string', description: 'The task to give Codex' },
      },
      required: ['workspace_id', 'prompt'],
    },
  },
  {
    name: 'github_api',
    description: 'Read repos, issues, and comments from GitHub. Write ops (comments) require user approval.',
    input_schema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list_repos', 'get_repo', 'list_issues', 'get_issue', 'create_issue_comment'] },
        owner: { type: 'string' },
        repo: { type: 'string' },
        issue_number: { type: 'number' },
        comment_body: { type: 'string' },
      },
      required: ['op'],
    },
  },
  {
    name: 'mcp_call',
    description: 'Call a tool on a configured MCP server.',
    input_schema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'ID of the MCP connection to use' },
        tool_name: { type: 'string', description: 'Name of the MCP tool to call' },
        tool_input: { type: 'object', description: 'Input for the MCP tool', additionalProperties: true },
      },
      required: ['connection_id', 'tool_name', 'tool_input'],
    },
  },
  {
    name: 'git_op',
    description: 'Run git operations in a workspace repo. Write ops (commit, push) require user approval.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        op: { type: 'string', enum: ['log', 'diff', 'status', 'commit', 'push'] },
        message: { type: 'string', description: 'Commit message (for commit op)' },
        branch: { type: 'string', description: 'Branch name (for push op)' },
      },
      required: ['workspace_id', 'op'],
    },
  },
  {
    name: 'workspace_query',
    description: 'Query the Graphify knowledge graph for a workspace to understand its code structure without reading raw files.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        question: { type: 'string', description: 'What to look up in the codebase' },
      },
      required: ['workspace_id', 'question'],
    },
  },
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
];
```

- [x] **Step 2: Commit**

```bash
git add server/src/tools/definitions.ts
git commit -m "feat: Anthropic tool definitions"
```

---

## Task 15: Lead Agent

**Files:**
- Create: `server/src/services/agent.ts`
- Create: `server/tests/services/agent.test.ts`

The lead agent runs an Anthropic tool-use loop. It builds context from thread history + user memory, then iterates: send to API → handle tool calls → collect results → send back until the model stops calling tools.

- [x] **Step 1: Write failing test**

```typescript
// tests/services/agent.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { runAgentTurn } from '../../src/services/agent.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
      }),
    },
  })),
}));

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));

const userId = newId();
let threadId: string;
let messageId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `agent-${userId}@test.com`, 'x');
  // Import crypto helpers (ESM dynamic import)
  const { encrypt, deriveKey } = await import('../../src/lib/crypto.js');
  db.prepare('INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)')
    .run(newId(), userId, 'main', 'anthropic', encrypt(JSON.stringify({ apiKey: 'sk-test' }), deriveKey()));
  threadId = newId();
  db.prepare('INSERT INTO threads (id, user_id) VALUES (?,?)').run(threadId, userId);
  messageId = newId();
  db.prepare('INSERT INTO messages (id, thread_id, role, content) VALUES (?,?,?,?)').run(messageId, threadId, 'user', 'Hello');
});

describe('agent', () => {
  it('returns an assistant message', async () => {
    const reply = await runAgentTurn(userId, threadId, messageId);
    expect(reply).toBeDefined();
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- tests/services/agent.test.ts
```

Expected: FAIL

- [x] **Step 3: Create server/src/services/agent.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { recallAll } from './memory.js';
import { toolDefinitions } from '../tools/definitions.js';
import { createExecution, completeExecution } from './executor.js';
import { runGitOp } from '../tools/git_op.js';
import { runGithubApi } from '../tools/github_api.js';
import { invokeClaudeCode } from '../tools/invoke_claude_code.js';
import { invokeCodex } from '../tools/invoke_codex.js';
import { callMcp } from '../tools/mcp_call.js';
import { runWorkspaceQuery } from '../tools/workspace_query.js';
import { remember, recall } from '../tools/memory_tools.js';
import { newId } from '../lib/ids.js';
import { broadcast } from './socket.js';

interface DbMessage { role: string; content: string; }
interface DbWorkspace { id: string; name: string; description: string | null; repo_path: string | null; enabled_connection_ids: string; }
interface DbConnection { id: string; name: string; type: string; }

function getAnthropicKey(userId: string): string {
  const conn = getDb()
    .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'anthropic' ORDER BY created_at LIMIT 1")
    .get(userId) as { id: string } | undefined;
  if (!conn) throw new Error('No Anthropic connection configured');
  const config = getDecryptedConfig(conn.id);
  return config.apiKey;
}

function getWorkspaces(userId: string): DbWorkspace[] {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM workspaces WHERE user_id = ?')
    .all(userId) as DbWorkspace[];
}

function getConnectionConfig(connectionId: string): Record<string, string> {
  return getDecryptedConfig(connectionId);
}

function buildSystemPrompt(userId: string): string {
  const memory = recallAll(userId);
  const workspaces = getWorkspaces(userId);
  const memoryText = Object.keys(memory).length > 0
    ? `\n\nUser memory:\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';
  const wsText = workspaces.length > 0
    ? `\n\nAvailable workspaces:\n${workspaces.map(w => `- ${w.name} (id: ${w.id})${w.description ? ': ' + w.description : ''}`).join('\n')}`
    : '\n\nNo workspaces configured yet.';

  return `You are a personal AI operator. You help the user plan, execute, and manage work across their projects and tools.

When the user gives you a task, determine which workspace it relates to (ask if unclear), then use the available tools to complete it. For coding work, prefer invoke_claude_code or invoke_codex over manual file edits. Query workspace_query before dispatching coding tools to understand the codebase structure.

You can run tools in parallel when the tasks are independent.

Write ops (git commit, push, github comments) will pause for user approval — this is expected behavior, not an error.
${memoryText}
${wsText}`;
}

async function dispatchTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  messageId: string
): Promise<string> {
  const workspaceId = (toolInput.workspace_id as string | undefined) ?? 'unknown';

  const executionId = createExecution(userId, messageId, workspaceId, toolName);

  try {
    let result: string;

    switch (toolName) {
      case 'invoke_claude_code': {
        const ws = getDb().prepare('SELECT repo_path, enabled_connection_ids FROM workspaces WHERE id = ?').get(workspaceId) as DbWorkspace;
        const connectionIds: string[] = JSON.parse(ws?.enabled_connection_ids ?? '[]');
        const anthropicConn = (getDb()
          .prepare("SELECT id FROM connections WHERE id IN (" + connectionIds.map(() => '?').join(',') + ") AND type = 'anthropic'")
          .get(...connectionIds) as { id: string } | undefined);
        const apiKey = anthropicConn ? getConnectionConfig(anthropicConn.id).apiKey : getAnthropicKey(userId);
        result = await invokeClaudeCode(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: ws?.repo_path ?? '/tmp', apiKey }
        );
        break;
      }
      case 'invoke_codex': {
        const ws = getDb().prepare('SELECT repo_path, enabled_connection_ids FROM workspaces WHERE id = ?').get(workspaceId) as DbWorkspace;
        const connectionIds: string[] = JSON.parse(ws?.enabled_connection_ids ?? '[]');
        const openaiConn = (getDb()
          .prepare("SELECT id FROM connections WHERE id IN (" + connectionIds.map(() => '?').join(',') + ") AND type = 'openai'")
          .get(...connectionIds) as { id: string } | undefined);
        const apiKey = openaiConn ? getConnectionConfig(openaiConn.id).apiKey : '';
        result = await invokeCodex(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: ws?.repo_path ?? '/tmp', apiKey }
        );
        break;
      }
      case 'github_api': {
        const connectionIds = getWorkspaces(userId).flatMap(w => JSON.parse(w.enabled_connection_ids) as string[]);
        const ghConn = (getDb()
          .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'github' LIMIT 1")
          .get(userId) as { id: string } | undefined);
        const token = ghConn ? getConnectionConfig(ghConn.id).token : '';
        result = await runGithubApi(toolInput as any, { userId, executionId, token });
        break;
      }
      case 'mcp_call': {
        const config = getConnectionConfig(toolInput.connection_id as string);
        result = await callMcp(
          { tool_name: toolInput.tool_name as string, tool_input: toolInput.tool_input as Record<string, unknown> },
          { command: config.command, args: config.args ? JSON.parse(config.args) : [], env: config.env ? JSON.parse(config.env) : {} }
        );
        break;
      }
      case 'git_op': {
        const ws = getDb().prepare('SELECT repo_path FROM workspaces WHERE id = ?').get(workspaceId) as { repo_path: string | null } | undefined;
        result = await runGitOp(
          { op: toolInput.op as any, message: toolInput.message as string | undefined },
          { userId, executionId, workspaceId, repoPath: ws?.repo_path ?? '/tmp' }
        );
        break;
      }
      case 'workspace_query':
        result = await runWorkspaceQuery({ workspace_id: workspaceId, question: toolInput.question as string });
        break;
      case 'remember':
        result = remember(userId, toolInput.key as string, toolInput.value as string);
        break;
      case 'recall':
        result = recall(userId, (toolInput.key as string | undefined) ?? null);
        break;
      default:
        result = `Unknown tool: ${toolName}`;
    }

    completeExecution(executionId, userId, 'done', result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    completeExecution(executionId, userId, 'error', msg);
    return `Error: ${msg}`;
  }
}

export async function runAgentTurn(userId: string, threadId: string, userMessageId: string): Promise<string> {
  const apiKey = getAnthropicKey(userId);
  const client = new Anthropic({ apiKey });

  const history = getDb()
    .prepare('SELECT role, content FROM messages WHERE thread_id = ? ORDER BY created_at')
    .all(threadId) as DbMessage[];

  const messages: Anthropic.MessageParam[] = history.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const systemPrompt = buildSystemPrompt(userId);
  let currentMessages = [...messages];

  while (true) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: toolDefinitions,
      messages: currentMessages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock ? (textBlock as Anthropic.TextBlock).text : '';
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];

      currentMessages.push({ role: 'assistant', content: response.content });

      // Dispatch all tool calls (potentially parallel)
      const toolResults = await Promise.all(
        toolUseBlocks.map(async block => {
          const result = await dispatchTool(block.name, block.input as Record<string, unknown>, userId, userMessageId);
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: result,
          };
        })
      );

      currentMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason
    break;
  }

  return '';
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd server && npm test -- tests/services/agent.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/services/agent.ts server/tests/services/agent.test.ts
git commit -m "feat: lead agent with Anthropic tool-use loop"
```

---

## Task 16: Messages Route (Agent Turn Trigger)

**Files:**
- Create: `server/src/routes/messages.ts`
- Create: `server/tests/messages.test.ts`

POST /threads/:id/messages saves the user message, triggers the agent turn async, saves the assistant reply, and returns the user message immediately. The client gets the assistant reply via WebSocket.

- [x] **Step 1: Write failing test**

```typescript
// tests/messages.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb } from '../src/db/index.js';

vi.mock('../src/services/agent.js', () => ({
  runAgentTurn: vi.fn().mockResolvedValue('Agent reply here'),
}));
vi.mock('../src/services/socket.js', () => ({ broadcast: vi.fn() }));

let token: string;
let threadId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const reg = await request(app)
    .post('/auth/register')
    .send({ email: `msg-${Date.now()}@test.com`, password: 'pass' });
  token = reg.body.token;
  const th = await request(app)
    .post('/threads')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Test thread' });
  threadId = th.body.id;
});

describe('messages', () => {
  it('saves user message and returns it', async () => {
    const res = await request(app)
      .post(`/threads/${threadId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Hello agent' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('user');
    expect(res.body.content).toBe('Hello agent');
  });

  it('lists messages including the assistant reply', async () => {
    await new Promise(r => setTimeout(r, 100)); // let async agent turn complete
    const res = await request(app)
      .get(`/threads/${threadId}/messages`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const roles = res.body.map((m: any) => m.role);
    expect(roles).toContain('assistant');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- tests/messages.test.ts
```

Expected: FAIL

- [x] **Step 3: Create server/src/routes/messages.ts**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { runAgentTurn } from '../services/agent.js';
import { broadcast } from '../services/socket.js';

const router = Router();
router.use(requireAuth);

router.get('/:threadId/messages', (req, res) => {
  const { userId } = req as AuthedRequest;
  const thread = getDb()
    .prepare('SELECT id FROM threads WHERE id = ? AND user_id = ?')
    .get(req.params.threadId, userId);
  if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

  const messages = getDb()
    .prepare('SELECT id, role, content, created_at FROM messages WHERE thread_id = ? ORDER BY created_at')
    .all(req.params.threadId);
  res.json(messages);
});

router.post('/:threadId/messages', async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return; }

  const thread = getDb()
    .prepare('SELECT id FROM threads WHERE id = ? AND user_id = ?')
    .get(req.params.threadId, userId);
  if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

  const messageId = newId();
  getDb()
    .prepare('INSERT INTO messages (id, thread_id, role, content) VALUES (?,?,?,?)')
    .run(messageId, req.params.threadId, 'user', content);
  getDb()
    .prepare('UPDATE threads SET updated_at = unixepoch() WHERE id = ?')
    .run(req.params.threadId);

  const userMessage = { id: messageId, role: 'user', content, created_at: Math.floor(Date.now() / 1000) };
  res.status(201).json(userMessage);

  // Trigger agent turn async — client gets reply via WebSocket
  setImmediate(async () => {
    try {
      const reply = await runAgentTurn(userId, req.params.threadId, messageId);
      if (reply) {
        const replyId = newId();
        getDb()
          .prepare('INSERT INTO messages (id, thread_id, role, content) VALUES (?,?,?,?)')
          .run(replyId, req.params.threadId, 'assistant', reply);
        getDb()
          .prepare('UPDATE threads SET updated_at = unixepoch() WHERE id = ?')
          .run(req.params.threadId);
        broadcast(userId, { type: 'message_created', message: { id: replyId, role: 'assistant', content: reply } });
      }
    } catch (err) {
      console.error('[agent turn error]', err);
    }
  });
});

export default router;
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd server && npm test -- tests/messages.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/routes/messages.ts server/tests/messages.test.ts
git commit -m "feat: messages route — POST triggers async agent turn, reply via WebSocket"
```

---

## Task 17: Executions Route (Approve / Reject)

**Files:**
- Create: `server/src/routes/executions.ts`
- Create: `server/tests/executions.test.ts`

- [x] **Step 1: Write failing test**

```typescript
// tests/executions.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb, getDb } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';
import { resolveApproval } from '../src/lib/approval.js';

vi.mock('../src/services/socket.js', () => ({ broadcast: vi.fn() }));

let token: string;
let userId: string;
let executionId: string;
let approvalId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const reg = await request(app)
    .post('/auth/register')
    .send({ email: `exec2-${Date.now()}@test.com`, password: 'pass' });
  token = reg.body.token;

  // Get userId from DB
  const user = getDb().prepare('SELECT id FROM users ORDER BY created_at DESC LIMIT 1').get() as { id: string };
  userId = user.id;

  // Seed an execution + approval directly
  executionId = newId();
  approvalId = newId();
  const db = getDb();
  const threadId = newId();
  const msgId = newId();
  const wsId = newId();
  db.prepare('INSERT INTO threads (id, user_id) VALUES (?,?)').run(threadId, userId);
  db.prepare('INSERT INTO messages (id, thread_id, role, content) VALUES (?,?,?,?)').run(msgId, threadId, 'user', 'test');
  db.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?,?,?)').run(wsId, userId, `ws-${newId()}`);
  db.prepare("INSERT INTO executions (id, message_id, workspace_id, tool, status) VALUES (?,?,?,?,?)").run(executionId, msgId, wsId, 'git_op', 'awaiting_approval');
  db.prepare("INSERT INTO approvals (id, execution_id, action, payload) VALUES (?,?,?,?)").run(approvalId, executionId, 'git commit', '{"message":"fix bug"}');
});

describe('executions', () => {
  it('gets an execution by id', async () => {
    const res = await request(app)
      .get(`/executions/${executionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('awaiting_approval');
  });

  it('approves an execution', async () => {
    // resolveApproval will be called by the route — we need to confirm it resolves
    const res = await request(app)
      .post(`/executions/${executionId}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- tests/executions.test.ts
```

Expected: FAIL

- [x] **Step 3: Create server/src/routes/executions.ts**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { resolveApproval } from '../lib/approval.js';

const router = Router();
router.use(requireAuth);

router.get('/:id', (req, res) => {
  const { userId } = req as AuthedRequest;
  const execution = getDb()
    .prepare(`
      SELECT e.id, e.tool, e.status, e.output_log, e.result, e.created_at, e.completed_at,
             e.workspace_id, a.id as approval_id, a.action, a.payload
      FROM executions e
      LEFT JOIN approvals a ON a.execution_id = e.id AND a.status = 'pending'
      LEFT JOIN messages m ON m.id = e.message_id
      LEFT JOIN threads t ON t.id = m.thread_id
      WHERE e.id = ? AND t.user_id = ?
    `)
    .get(req.params.id, userId);
  if (!execution) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(execution);
});

router.post('/:id/approve', (req, res) => {
  const { userId } = req as AuthedRequest;
  const approval = getDb()
    .prepare(`
      SELECT a.id FROM approvals a
      JOIN executions e ON e.id = a.execution_id
      JOIN messages m ON m.id = e.message_id
      JOIN threads t ON t.id = m.thread_id
      WHERE e.id = ? AND t.user_id = ? AND a.status = 'pending'
    `)
    .get(req.params.id, userId) as { id: string } | undefined;
  if (!approval) { res.status(404).json({ error: 'No pending approval found' }); return; }
  resolveApproval(approval.id, 'approved');
  res.json({ status: 'approved' });
});

router.post('/:id/reject', (req, res) => {
  const { userId } = req as AuthedRequest;
  const approval = getDb()
    .prepare(`
      SELECT a.id FROM approvals a
      JOIN executions e ON e.id = a.execution_id
      JOIN messages m ON m.id = e.message_id
      JOIN threads t ON t.id = m.thread_id
      WHERE e.id = ? AND t.user_id = ? AND a.status = 'pending'
    `)
    .get(req.params.id, userId) as { id: string } | undefined;
  if (!approval) { res.status(404).json({ error: 'No pending approval found' }); return; }
  resolveApproval(approval.id, 'rejected');
  res.json({ status: 'rejected' });
});

export default router;
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd server && npm test -- tests/executions.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/routes/executions.ts server/tests/executions.test.ts
git commit -m "feat: executions route — GET, approve, reject"
```

---

## Task 18: Full Test Run + Smoke Test

- [x] **Step 1: Run the full test suite**

```bash
cd server && npm test
```

Expected: all tests pass, no failures.

- [x] **Step 2: Start the server and verify all routes respond**

```bash
cd server && npm run dev &
sleep 2

# Register
TOKEN=$(curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.com","password":"password123"}' | jq -r .token)

echo "Token: $TOKEN"

# Create connection
curl -s -X POST http://localhost:3000/connections \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"main","type":"anthropic","config":{"apiKey":"sk-test"}}' | jq .

# Create workspace
curl -s -X POST http://localhost:3000/workspaces \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"api","description":"My API project"}' | jq .

# Create thread
curl -s -X POST http://localhost:3000/threads \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"First conversation"}' | jq .

kill %1
```

Expected: each request returns valid JSON with an `id` field.

- [x] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: full test suite passing, smoke test verified"
```

---

## Summary

After completing all 18 tasks you will have:

- A fully tested Express + TypeScript server with SQLite persistence
- JWT auth with first-user-only registration
- CRUD for connections (encrypted), workspaces, threads, messages
- WebSocket server broadcasting execution events to authenticated clients
- User memory (remember/recall)
- Graphify subprocess integration for workspace knowledge graphs
- All 8 tool implementations: Claude Code, Codex, GitHub API, MCP, git ops, workspace query, memory
- Lead agent running the Anthropic tool-use loop with parallel tool dispatch
- Approval gate: destructive actions pause for user approval before executing
- POST /threads/:id/messages triggering async agent turns with WebSocket reply delivery

**Next plans:** `/web` (React minimal UI), `/app` (SwiftUI iOS client)
