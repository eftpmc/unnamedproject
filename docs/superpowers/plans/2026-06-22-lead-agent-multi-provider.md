# Lead Agent Multi-Provider Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the lead agent to run on Anthropic (Claude), OpenAI (GPT-4o / GPT-5), or a local OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp), configured per user in Settings.

**Architecture:** Extract the ~30 lines in `runAgentTurn()` that create an Anthropic client and stream a response behind a `LeadAgentProvider` interface. The turn loop (tool dispatch, approval handling, retry, abort) stays entirely unchanged. Translation between Anthropic and OpenAI wire formats lives in the new provider file; nothing else changes protocol.

**Tech Stack:** `openai` npm SDK (OpenAI-compatible, handles both `api.openai.com` and custom `baseURL`); existing `@anthropic-ai/sdk`; `better-sqlite3` for the migration; React state for the Settings UI.

## Global Constraints

- TypeScript — no `any` except where the existing codebase already uses it for low-level JSON blobs.
- No new runtime dependencies except `openai` SDK.
- The turn loop inside `runAgentTurn()` must not change in observable behaviour for Anthropic connections (zero regression).
- SQLite migration must be idempotent (check before rebuilding table).
- No tests exist for this area of the codebase — skip the TDD loop; test manually as described in each task.

---

## File Map

| File | Action |
|------|--------|
| `server/package.json` | Add `openai` dependency |
| `server/src/db/index.ts` | Add migration v4: widen `connections.type` CHECK to include `'local'` |
| `server/src/routes/connections.ts` | Add `'local'` to `VALID_TYPES`; allow `lead_agent` purpose with all three types; validate `modelName`/`baseUrl` config fields; add `'local'` test-connection branch |
| `server/src/services/anthropic.ts` | Add `getLeadAgentConnection()` returning typed union; keep `getAnthropicKey()` unchanged |
| `server/src/services/lead_agent_providers.ts` | **New file** — interface + `AnthropicProvider` + `OpenAICompatibleProvider` + format translation + `getLeadAgentProvider()` factory |
| `server/src/services/agent.ts` | Replace hardcoded Anthropic client setup (lines ~1295–1340) in `runAgentTurn()` with `getLeadAgentProvider()` |
| `web/src/pages/Settings.tsx` | Provider picker + conditional credential fields for the lead agent setup modal |

---

### Task 1: Install openai SDK

**Files:**
- Modify: `server/package.json`

**Interfaces:**
- Produces: `import OpenAI from 'openai'` works in server TypeScript

- [ ] **Step 1: Install the SDK**

```bash
cd server && npm install openai
```

Expected: `openai` appears in `server/package.json` `dependencies` and `server/node_modules/openai` exists.

- [ ] **Step 2: Verify TypeScript can import it**

```bash
cd server && npx tsx -e "import OpenAI from 'openai'; console.log(typeof OpenAI);"
```

Expected output: `function`

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore(server): add openai SDK"
```

---

### Task 2: DB migration — add 'local' connection type

**Files:**
- Modify: `server/src/db/index.ts` (lines 22–27 — the `migrations` array and the new migration function)

**Context:** The `connections` table has `type TEXT NOT NULL CHECK(type IN ('anthropic','openai','github','mcp'))`. SQLite cannot alter CHECK constraints in-place; the standard pattern here is to rename the table, recreate it, copy data, and drop the old table. All existing migrations use this same approach. The migration version must be 4 (current max is 3 — see `migrate.ts`).

**Interfaces:**
- Produces: `connections.type` accepts `'local'` without a CHECK violation

- [ ] **Step 1: Add the migration function and register it**

Open `server/src/db/index.ts`. At the bottom of the file (after the `addToolRegistry` function and before `export function initDb`), add:

```ts
function widenConnectionsTypeForLocal(database: Database.Database): void {
  const sql = tableSql(database, 'connections');
  if (!sql || sql.includes("'local'")) return; // already applied
  database.exec(`
    PRAGMA foreign_keys = OFF;
    PRAGMA legacy_alter_table = ON;
    ALTER TABLE connections RENAME TO connections_pre_local_type;
    PRAGMA legacy_alter_table = OFF;
    CREATE TABLE connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('anthropic','openai','github','mcp','local')),
      purpose TEXT NOT NULL DEFAULT 'tool',
      encrypted_config TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );
    INSERT INTO connections SELECT * FROM connections_pre_local_type;
    DROP TABLE connections_pre_local_type;
    PRAGMA foreign_keys = ON;
  `);
}
```

Then add this entry to the `migrations` array (currently ends at version 3):

```ts
{ version: 4, name: 'widen-connection-type-for-local', noTransaction: true, up: widenConnectionsTypeForLocal },
```

The migration array should now look like:

```ts
const migrations: Migration[] = [
  { version: 1, name: 'baseline-schema', noTransaction: true, up: () => applySchema() },
  { version: 2, name: 'repair-plan-foreign-keys', noTransaction: true, up: repairPlanForeignKeys },
  { version: 3, name: 'tool-registry', up: addToolRegistry },
  { version: 4, name: 'widen-connection-type-for-local', noTransaction: true, up: widenConnectionsTypeForLocal },
];
```

- [ ] **Step 2: Smoke-test the migration**

```bash
cd server && npx tsx -e "
import { initDb, getDb } from './src/db/index.js';
initDb();
const db = getDb();
db.prepare(\"INSERT INTO connections (id, user_id, name, type, purpose, encrypted_config) VALUES ('test','u1','t','local','lead_agent','{}')\").run();
console.log(db.prepare(\"SELECT type FROM connections WHERE id='test'\").get());
db.prepare(\"DELETE FROM connections WHERE id='test'\").run();
console.log('OK');
"
```

Expected output: `{ type: 'local' }` then `OK`

- [ ] **Step 3: Commit**

```bash
git add server/src/db/index.ts
git commit -m "feat(db): add 'local' as valid connections.type via migration v4"
```

---

### Task 3: Connection route — support local type and lead_agent with any provider

**Files:**
- Modify: `server/src/routes/connections.ts` (lines 1–50 and the test endpoint around line 67)

**Context:** The relevant section currently reads:

```ts
const VALID_TYPES = ['anthropic', 'openai', 'github', 'mcp'] as const;
const VALID_PURPOSES = ['lead_agent', 'claude_code', 'codex', 'github', 'mcp', 'tool'] as const;
const PURPOSE_TYPE: Record<string, string> = {
  lead_agent: 'anthropic',
  claude_code: 'anthropic',
  codex: 'openai',
  github: 'github',
  mcp: 'mcp',
};
```

Changes needed:
1. Add `'local'` to `VALID_TYPES`.
2. `PURPOSE_TYPE` becomes a map of purpose → accepted type(s). `lead_agent` accepts all three provider types.
3. Validate that `openai` lead_agent config includes `modelName`; `local` config includes `baseUrl` and `modelName`.
4. Test endpoint: handle `'local'` by fetching `${config.baseUrl}/models`.

**Interfaces:**
- Produces: `POST /connections` accepts `{ type: 'local', purpose: 'lead_agent', config: { baseUrl, modelName, apiKey? } }`
- Produces: `GET /connections/:id/test` returns `{ ok: true }` for a reachable local endpoint

- [ ] **Step 1: Update VALID_TYPES, PURPOSE_TYPE, and config validation**

Find and replace the top section of `server/src/routes/connections.ts`. The current block (starting with `const VALID_TYPES`) becomes:

```ts
const VALID_TYPES = ['anthropic', 'openai', 'github', 'mcp', 'local'] as const;
const VALID_PURPOSES = ['lead_agent', 'claude_code', 'codex', 'github', 'mcp', 'tool'] as const;

// For most purposes exactly one type is valid. lead_agent accepts all three provider types.
const PURPOSE_ALLOWED_TYPES: Record<string, string[]> = {
  lead_agent: ['anthropic', 'openai', 'local'],
  claude_code: ['anthropic'],
  codex: ['openai'],
  github: ['github'],
  mcp: ['mcp'],
};
```

Then find the validation block in the POST handler that currently does:
```ts
if (PURPOSE_TYPE[connectionPurpose] && PURPOSE_TYPE[connectionPurpose] !== type) {
  res.status(400).json({ error: `Purpose '${connectionPurpose}' requires type '${PURPOSE_TYPE[connectionPurpose]}'` });
  return;
}
```

Replace it with:
```ts
const allowedTypes = PURPOSE_ALLOWED_TYPES[connectionPurpose];
if (allowedTypes && !allowedTypes.includes(type)) {
  res.status(400).json({ error: `Purpose '${connectionPurpose}' does not support type '${type}'. Allowed: ${allowedTypes.join(', ')}` });
  return;
}
```

After that validation block, add config field validation for the new lead_agent provider types. Insert just before the INSERT statement:

```ts
// Validate required config fields for lead_agent non-anthropic providers
if (connectionPurpose === 'lead_agent' && type === 'openai') {
  const cfg = config as Record<string, unknown>;
  if (!cfg.modelName || typeof cfg.modelName !== 'string') {
    res.status(400).json({ error: "OpenAI lead agent connection requires 'modelName' in config (e.g. 'gpt-4o')" });
    return;
  }
}
if (connectionPurpose === 'lead_agent' && type === 'local') {
  const cfg = config as Record<string, unknown>;
  if (!cfg.baseUrl || typeof cfg.baseUrl !== 'string') {
    res.status(400).json({ error: "Local lead agent connection requires 'baseUrl' in config (e.g. 'http://localhost:11434/v1')" });
    return;
  }
  if (!cfg.modelName || typeof cfg.modelName !== 'string') {
    res.status(400).json({ error: "Local lead agent connection requires 'modelName' in config (e.g. 'qwen2.5:14b')" });
    return;
  }
}
```

- [ ] **Step 2: Add 'local' to the test-connection endpoint**

In the `GET /:id/test` handler, find the `else if (row.type === 'github')` block and add after it:

```ts
} else if (row.type === 'local') {
  const baseUrl = config.baseUrl?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('Missing baseUrl in local connection config');
  const headers: Record<string, string> = {};
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  const r = await fetch(`${baseUrl}/models`, { headers });
  // Local servers (Ollama, LM Studio) may return 401 without a key — that still
  // means the server is reachable, which is what the test cares about.
  if (!r.ok && r.status !== 401) throw new Error(`HTTP ${r.status}`);
```

- [ ] **Step 3: Smoke-test via curl (after server restart)**

```bash
# Start the server
cd server && npm run dev &

# Create a local connection (should succeed)
curl -s -X POST http://localhost:3000/connections \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"name":"Local Ollama","type":"local","purpose":"lead_agent","config":{"baseUrl":"http://localhost:11434/v1","modelName":"qwen2.5:14b"}}' | jq .

# Should return { "id": "..." }

# Create a local connection with wrong type for claude_code (should fail)
curl -s -X POST http://localhost:3000/connections \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"name":"Bad","type":"local","purpose":"claude_code","config":{"apiKey":"x"}}' | jq .

# Should return 400 with error about allowed types
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/connections.ts
git commit -m "feat(connections): support local provider type and lead_agent with openai/local"
```

---

### Task 4: getLeadAgentConnection() in anthropic.ts

**Files:**
- Modify: `server/src/services/anthropic.ts`

**Context:** The existing `getAnthropicKey(userId)` fetches the connection and returns `config.apiKey`. The new function returns a typed union covering all three provider configurations. `getAnthropicKey` is called in many other places (coding agents, memory extraction) and must not change.

**Interfaces:**
- Produces:
  ```ts
  export type LeadAgentConnection =
    | { type: 'anthropic'; apiKey: string }
    | { type: 'openai'; apiKey: string; modelName: string }
    | { type: 'local'; baseUrl: string; modelName: string; apiKey?: string };
  
  export function getLeadAgentConnection(userId: string): LeadAgentConnection
  ```

- [ ] **Step 1: Add the exported type and function to anthropic.ts**

Add after the `getAnthropicKey` function (around line 70):

```ts
export type LeadAgentConnection =
  | { type: 'anthropic'; apiKey: string }
  | { type: 'openai'; apiKey: string; modelName: string }
  | { type: 'local'; baseUrl: string; modelName: string; apiKey?: string };

export function getLeadAgentConnection(userId: string): LeadAgentConnection {
  const conn = getDb()
    .prepare(`
      SELECT id, type FROM connections
      WHERE user_id = ? AND purpose = 'lead_agent'
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(userId) as { id: string; type: string } | undefined;

  if (!conn) {
    // Fall back to any anthropic connection (matches existing getAnthropicKey behaviour)
    const fallback = getDb()
      .prepare(`
        SELECT id FROM connections
        WHERE user_id = ? AND type = 'anthropic'
        ORDER BY created_at
        LIMIT 1
      `)
      .get(userId) as { id: string } | undefined;
    if (!fallback) throw new Error('No lead agent connection configured. Add a connection in Settings.');
    const config = getDecryptedConfig(fallback.id, userId);
    return { type: 'anthropic', apiKey: config.apiKey };
  }

  const config = getDecryptedConfig(conn.id, userId);
  if (conn.type === 'openai') {
    return { type: 'openai', apiKey: config.apiKey, modelName: config.modelName };
  }
  if (conn.type === 'local') {
    return { type: 'local', baseUrl: config.baseUrl, modelName: config.modelName, apiKey: config.apiKey || undefined };
  }
  // anthropic (default)
  return { type: 'anthropic', apiKey: config.apiKey };
}
```

Also add `getLeadAgentConnection` to the import in any consumer files (done in Task 6).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: zero errors (or the same pre-existing errors that existed before this task).

- [ ] **Step 3: Commit**

```bash
git add server/src/services/anthropic.ts
git commit -m "feat(anthropic): add getLeadAgentConnection() returning typed union"
```

---

### Task 5: lead_agent_providers.ts — provider interface and implementations

**Files:**
- Create: `server/src/services/lead_agent_providers.ts`

**Context:** This file contains everything needed to abstract the streaming call:
1. The `LeadAgentProvider` interface (what `runAgentTurn` calls).
2. `AnthropicProvider` — thin wrapper around existing SDK streaming.
3. `OpenAICompatibleProvider` — handles both `openai` and `local` types via `baseURL` parameter.
4. Format translation functions (Anthropic ↔ OpenAI wire formats).
5. `getLeadAgentProvider(userId)` factory that reads the connection and returns the right provider.

The `stream()` method takes Anthropic-format inputs, returns Anthropic-format outputs. The caller (`runAgentTurn`) never sees OpenAI types.

The `onText` callback fires for each text delta during streaming — `runAgentTurn` uses it to write to the DB and broadcast to the UI in real time.

**Interfaces:**
- Consumes: `getLeadAgentConnection` from `./anthropic.js`; `LeadAgentConnection` type from `./anthropic.js`
- Produces:
  ```ts
  interface StreamParams {
    model: string;
    system: string;
    tools: Anthropic.Tool[];
    messages: Anthropic.MessageParam[];
    signal?: AbortSignal;
    onText: (delta: string) => void;
  }
  interface StreamResult {
    contentBlocks: Anthropic.ContentBlock[];
    inputTokens: number;
    outputTokens: number;
  }
  interface LeadAgentProvider {
    stream(params: StreamParams): Promise<StreamResult>;
    resolveModel(session: { model: string | null } | undefined, intent: { model: string }, effort: EffortLevel): Promise<string>;
  }
  export function getLeadAgentProvider(userId: string): Promise<LeadAgentProvider>
  ```

- [ ] **Step 1: Create the file**

Create `server/src/services/lead_agent_providers.ts` with the following content:

```ts
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { EffortLevel } from './anthropic.js';
import { getLeadAgentConnection, resolveModelForTurn } from './anthropic.js';

interface StreamParams {
  model: string;
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
}

interface StreamResult {
  contentBlocks: Anthropic.ContentBlock[];
  inputTokens: number;
  outputTokens: number;
}

interface LeadAgentProvider {
  stream(params: StreamParams): Promise<StreamResult>;
  resolveModel(
    session: { model: string | null } | undefined,
    intent: { model: string },
    effort: EffortLevel,
  ): Promise<string>;
}

// ─── Format translation ────────────────────────────────────────────────────

function toOpenAITools(tools: Anthropic.Tool[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

function toOpenAIMessages(
  messages: Anthropic.MessageParam[],
  system: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
  ];

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content });
        continue;
      }
      // Mixed content: tool_result blocks → separate role:'tool' messages; text → user message
      const toolResults = msg.content.filter(
        (b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result',
      );
      const textBlocks = msg.content.filter(
        (b): b is Anthropic.TextBlockParam => b.type === 'text',
      );
      for (const tr of toolResults) {
        const content = typeof tr.content === 'string'
          ? tr.content
          : Array.isArray(tr.content)
            ? tr.content.map(b => (b as Anthropic.TextBlockParam).text ?? '').join('')
            : '';
        result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content });
      }
      if (textBlocks.length > 0) {
        result.push({ role: 'user', content: textBlocks.map(b => b.text).join('\n') });
      }
    } else {
      // assistant
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content });
        continue;
      }
      const textBlocks = msg.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      const toolUseBlocks = msg.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: textBlocks.length > 0 ? textBlocks.map(b => b.text).join('\n') : null,
      };
      if (toolUseBlocks.length > 0) {
        assistantMsg.tool_calls = toolUseBlocks.map(b => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));
      }
      result.push(assistantMsg);
    }
  }

  return result;
}

// ─── Anthropic provider ───────────────────────────────────────────────────

class AnthropicProvider implements LeadAgentProvider {
  private client: Anthropic;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new Anthropic({ apiKey });
  }

  async resolveModel(
    session: { model: string | null } | undefined,
    intent: { model: string },
    effort: EffortLevel,
  ): Promise<string> {
    return session?.model ?? resolveModelForTurn(this.client, intent, effort, this.apiKey);
  }

  async stream({ model, system, tools, messages, signal, onText }: StreamParams): Promise<StreamResult> {
    const s = this.client.messages.stream(
      { model, max_tokens: 8192, system, tools, messages },
      { headers: { 'anthropic-beta': 'web-fetch-2025-09-10' }, signal },
    );

    s.on('text', onText);

    const response = await s.finalMessage();

    return {
      contentBlocks: response.content as Anthropic.ContentBlock[],
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

// ─── OpenAI-compatible provider (openai + local) ──────────────────────────

class OpenAICompatibleProvider implements LeadAgentProvider {
  private client: OpenAI;
  private configuredModel: string;

  constructor(apiKey: string, configuredModel: string, baseURL?: string) {
    this.configuredModel = configuredModel;
    this.client = new OpenAI({ apiKey: apiKey || 'local', baseURL });
  }

  async resolveModel(
    session: { model: string | null } | undefined,
  ): Promise<string> {
    return session?.model ?? this.configuredModel;
  }

  async stream({ model, system, tools, messages, signal, onText }: StreamParams): Promise<StreamResult> {
    const openAIMessages = toOpenAIMessages(messages, system);
    const openAITools = tools.length > 0 ? toOpenAITools(tools) : undefined;

    const stream = this.client.chat.completions.stream(
      {
        model,
        max_tokens: 8192,
        messages: openAIMessages,
        ...(openAITools ? { tools: openAITools } : {}),
      },
      { signal },
    );

    // Accumulate tool call argument strings (streamed as deltas)
    const toolCallAccumulators = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        onText(delta.content);
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccumulators.has(idx)) {
            toolCallAccumulators.set(idx, { id: '', name: '', arguments: '' });
          }
          const acc = toolCallAccumulators.get(idx)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    }

    const finalCompletion = await stream.finalChatCompletion();
    const usage = finalCompletion.usage;

    // Rebuild content blocks in Anthropic format
    const textContent = finalCompletion.choices[0]?.message.content ?? '';
    const contentBlocks: Anthropic.ContentBlock[] = [];

    if (textContent) {
      contentBlocks.push({ type: 'text', text: textContent });
    }

    for (const [, acc] of toolCallAccumulators) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(acc.arguments || '{}'); } catch { /* malformed JSON — pass empty input */ }
      contentBlocks.push({
        type: 'tool_use',
        id: acc.id,
        name: acc.name,
        input,
      });
    }

    return {
      contentBlocks,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────

export type { LeadAgentProvider };

export function getLeadAgentProvider(userId: string): LeadAgentProvider {
  const conn = getLeadAgentConnection(userId);

  if (conn.type === 'openai') {
    return new OpenAICompatibleProvider(conn.apiKey, conn.modelName);
  }
  if (conn.type === 'local') {
    return new OpenAICompatibleProvider(conn.apiKey ?? '', conn.modelName, conn.baseUrl);
  }
  // anthropic
  return new AnthropicProvider(conn.apiKey);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: zero new errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/lead_agent_providers.ts
git commit -m "feat(agent): add LeadAgentProvider interface with Anthropic and OpenAI-compatible implementations"
```

---

### Task 6: Wire provider into runAgentTurn

**Files:**
- Modify: `server/src/services/agent.ts`

**Context:** `runAgentTurn` currently starts with:

```ts
export async function runAgentTurn(userId: string, sessionId: string, userMessageId: string): Promise<void> {
  let apiKey: string;
  try {
    apiKey = getAnthropicKey(userId);
  } catch {
    if (process.env.ANTHROPIC_API_KEY) {
      apiKey = process.env.ANTHROPIC_API_KEY;
    } else {
      throw new Error('No Anthropic API key configured...');
    }
  }
  const client = new Anthropic({ apiKey });

  const session = getDb()
    .prepare('SELECT effort, model, summary FROM sessions WHERE id = ?')
    .get(sessionId) as ...;
  const effort = session?.effort ?? DEFAULT_EFFORT;
  ...
  const model = session?.model ?? await resolveModelForTurn(client, intent, effort, apiKey);
```

And the inner loop:

```ts
  for (let attempt = 0; ; attempt++) {
    const stream = client.messages.stream({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      tools: tools,
      messages: currentMessages,
    }, {
      headers: { 'anthropic-beta': 'web-fetch-2025-09-10' },
      signal: abortController.signal,
    });

    stream.on('text', (delta) => {
      if (!started) {
        started = true;
        getDb()
          .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
          .run(replyId, sessionId, 'assistant', '');
        broadcast(userId, { type: 'message_started', sessionId, message: { id: replyId, role: 'assistant', content: '' } });
      }
      fullText += delta;
      broadcast(userId, { type: 'message_delta', sessionId, messageId: replyId, delta });
    });

    try {
      response = await stream.finalMessage();
      break;
    } catch (err) {
      if (started || attempt >= 2 || !isTransientApiError(err)) throw err;
      await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  totalInputTokens += response.usage.input_tokens;
  totalOutputTokens += response.usage.output_tokens;

  if (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];
    currentMessages.push({ role: 'assistant', content: response.content });
```

And at the very end of the function:

```ts
  extractAndRemember(userId, sessionId, apiKey).catch(() => {});
  maybeDistill(userId, sessionId, apiKey).catch(() => {});
```

Also note the import line (line 26):
```ts
import { DEFAULT_EFFORT, getAnthropicKey, resolveModelForTurn, listClaudeModels, tokensToUsd, withTransientRetry, isTransientApiError, type EffortLevel } from './anthropic.js';
```

**Changes needed:**
1. Import `getLeadAgentProvider` from `./lead_agent_providers.js`.
2. Add `getAnthropicKey` to the existing anthropic.ts import (it's already there — keep it for other uses).
3. Replace the ~12-line Anthropic setup block with `getLeadAgentProvider(userId)`.
4. Replace `resolveModelForTurn(client, intent, effort, apiKey)` with `provider.resolveModel(session, intent, effort)`.
5. Replace the inner streaming for-loop with a `provider.stream()` call.
6. Replace `response.stop_reason === 'tool_use'` check with `toolUseBlocks.length > 0`.
7. At the end of the function, use `getAnthropicKey` independently for `extractAndRemember`/`maybeDistill` (these always need an Anthropic key regardless of lead agent provider).

**Interfaces:**
- Consumes: `LeadAgentProvider`, `getLeadAgentProvider` from `./lead_agent_providers.js`

- [ ] **Step 1: Add import for getLeadAgentProvider**

Find the import line:
```ts
import { DEFAULT_EFFORT, getAnthropicKey, resolveModelForTurn, listClaudeModels, tokensToUsd, withTransientRetry, isTransientApiError, type EffortLevel } from './anthropic.js';
```

Add a new import line after it:
```ts
import { getLeadAgentProvider } from './lead_agent_providers.js';
```

- [ ] **Step 2: Replace the Anthropic client setup block**

Find the block:
```ts
export async function runAgentTurn(userId: string, sessionId: string, userMessageId: string): Promise<void> {
  let apiKey: string;
  try {
    apiKey = getAnthropicKey(userId);
  } catch {
    if (process.env.ANTHROPIC_API_KEY) {
      apiKey = process.env.ANTHROPIC_API_KEY;
    } else {
      throw new Error('No Anthropic API key configured. Add a connection in Settings or set ANTHROPIC_API_KEY in the environment.');
    }
  }
  const client = new Anthropic({ apiKey });
```

Replace it with:
```ts
export async function runAgentTurn(userId: string, sessionId: string, userMessageId: string): Promise<void> {
  const provider = getLeadAgentProvider(userId);
```

- [ ] **Step 3: Replace model resolution**

Find:
```ts
  const model = session?.model ?? await resolveModelForTurn(client, intent, effort, apiKey);
```

Replace with:
```ts
  const model = await provider.resolveModel(session, intent, effort);
```

- [ ] **Step 4: Replace the streaming inner loop**

Find the block starting with `let response: Anthropic.Message | undefined;` and ending just before `totalInputTokens +=`:

```ts
      let response: Anthropic.Message | undefined;
      for (let attempt = 0; ; attempt++) {
        const stream = client.messages.stream({
          model,
          max_tokens: 8192,
          system: systemPrompt,
          tools: tools,
          messages: currentMessages,
        }, {
          headers: { 'anthropic-beta': 'web-fetch-2025-09-10' },
          signal: abortController.signal,
        });

        stream.on('text', (delta) => {
          if (!started) {
            started = true;
            getDb()
              .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
              .run(replyId, sessionId, 'assistant', '');
            broadcast(userId, { type: 'message_started', sessionId, message: { id: replyId, role: 'assistant', content: '' } });
          }
          fullText += delta;
          broadcast(userId, { type: 'message_delta', sessionId, messageId: replyId, delta });
        });

        try {
          response = await stream.finalMessage();
          break;
        } catch (err) {
          // Only safe to retry before any text has reached the client — once streamed, a retry would duplicate output.
          if (started || attempt >= 2 || !isTransientApiError(err)) throw err;
          await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
        }
      }
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
```

Replace with:
```ts
      let contentBlocks: Anthropic.ContentBlock[] = [];
      let turnInputTokens = 0;
      let turnOutputTokens = 0;
      for (let attempt = 0; ; attempt++) {
        try {
          ({ contentBlocks, inputTokens: turnInputTokens, outputTokens: turnOutputTokens } =
            await provider.stream({
              model,
              system: systemPrompt,
              tools,
              messages: currentMessages,
              signal: abortController.signal,
              onText: (delta) => {
                if (!started) {
                  started = true;
                  getDb()
                    .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
                    .run(replyId, sessionId, 'assistant', '');
                  broadcast(userId, { type: 'message_started', sessionId, message: { id: replyId, role: 'assistant', content: '' } });
                }
                fullText += delta;
                broadcast(userId, { type: 'message_delta', sessionId, messageId: replyId, delta });
              },
            }));
          break;
        } catch (err) {
          // Only safe to retry before any text has reached the client — once streamed, a retry would duplicate output.
          if (started || attempt >= 2 || !isTransientApiError(err)) throw err;
          await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
        }
      }
      totalInputTokens += turnInputTokens;
      totalOutputTokens += turnOutputTokens;
```

- [ ] **Step 5: Replace stop_reason check**

Find:
```ts
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];

        currentMessages.push({ role: 'assistant', content: response.content });
```

Replace with:
```ts
      const toolUseBlocks = contentBlocks.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];
      if (toolUseBlocks.length > 0) {
        currentMessages.push({ role: 'assistant', content: contentBlocks });
```

- [ ] **Step 6: Fix extractAndRemember and maybeDistill**

Find at the bottom of `runAgentTurn`:
```ts
  extractAndRemember(userId, sessionId, apiKey).catch(() => {});
  maybeDistill(userId, sessionId, apiKey).catch(() => {});
```

Replace with:
```ts
  // Memory extraction always uses an Anthropic model regardless of lead agent provider.
  try {
    const anthropicKey = getAnthropicKey(userId);
    extractAndRemember(userId, sessionId, anthropicKey).catch(() => {});
    maybeDistill(userId, sessionId, anthropicKey).catch(() => {});
  } catch { /* no Anthropic key configured — skip memory extraction */ }
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: zero new errors.

- [ ] **Step 8: Smoke-test with existing Anthropic connection**

Start the server and send a message in the chat. Verify:
- Text streams in real-time (message appears character by character)
- Tool calls work (e.g., `list_dir` if the agent uses it)
- Turn completes without error

This confirms the AnthropicProvider produces the same output as the old code path.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/agent.ts
git commit -m "feat(agent): replace hardcoded Anthropic setup with LeadAgentProvider abstraction"
```

---

### Task 7: Settings UI — provider picker for lead agent

**Files:**
- Modify: `web/src/pages/Settings.tsx`

**Context:** The lead agent setup modal (`activeSetup === 'lead_agent'`) currently renders a single API key field. We need:
1. A three-button provider picker (`Claude`, `OpenAI`, `Local Model`) shown at the top of the form.
2. Fields that change based on the selected provider.
3. The mutation sends the correct `type` and `config` to the server.

New state variables to add to the Settings component (alongside the existing `secret`, `setupName`, etc.):
```ts
const [leadAgentProvider, setLeadAgentProvider] = useState<'anthropic' | 'openai' | 'local'>('anthropic');
const [openaiModelName, setOpenaiModelName] = useState('');
const [localBaseUrl, setLocalBaseUrl] = useState('');
const [localModelName, setLocalModelName] = useState('');
```

The `SETUP_META.lead_agent.type` is currently `'anthropic'` — this is now dynamic, so we can't rely on it for the mutation. The mutation will check `activeSetup === 'lead_agent'` and use `leadAgentProvider` instead.

The `openSetupModal` function resets state — add resets for the new fields there.

**Interfaces:**
- Consumes: `POST /connections` accepting `type: 'openai' | 'local'` with `config: { apiKey, modelName }` or `{ baseUrl, modelName, apiKey? }`
- Produces: rendered provider picker UI visible in the lead agent setup modal

- [ ] **Step 1: Add new state variables**

Find the block of state declarations in the Settings component. After:
```ts
  const [setupError, setSetupError] = useState('');
```

Add:
```ts
  const [leadAgentProvider, setLeadAgentProvider] = useState<'anthropic' | 'openai' | 'local'>('anthropic');
  const [openaiModelName, setOpenaiModelName] = useState('');
  const [localBaseUrl, setLocalBaseUrl] = useState('');
  const [localModelName, setLocalModelName] = useState('');
```

- [ ] **Step 2: Reset new state in openSetupModal and closeSetupModal**

Find `function openSetupModal(kind: SetupKind)`. It currently ends with:
```ts
    setMcpPreset('custom'); setMcpExtraArg(''); setMcpEnvValues({}); setSetupError('');
```

Add after that line (still inside `openSetupModal`):
```ts
    setLeadAgentProvider('anthropic');
    setOpenaiModelName(''); setLocalBaseUrl(''); setLocalModelName('');
```

Find `function closeSetupModal()`. Add the same resets at the end:
```ts
    setLeadAgentProvider('anthropic');
    setOpenaiModelName(''); setLocalBaseUrl(''); setLocalModelName('');
```

- [ ] **Step 3: Update the mutation to handle lead_agent provider types**

In `createConnMutation.mutationFn`, find the `else` branch that handles non-MCP connections:
```ts
      } else {
        if (!secret.trim() && !meta.secretOptional) throw new Error(`${meta.secretLabel} required`);
        config = { apiKey: secret.trim() };
      }

      return createConnection({ name: setupName.trim() || meta.title, type: meta.type, purpose: activeSetup, config });
```

Replace the `else` branch with:
```ts
      } else if (activeSetup === 'lead_agent') {
        if (leadAgentProvider === 'anthropic') {
          if (!secret.trim()) throw new Error('Anthropic API key required');
          config = { apiKey: secret.trim() };
        } else if (leadAgentProvider === 'openai') {
          if (!secret.trim()) throw new Error('OpenAI API key required');
          if (!openaiModelName.trim()) throw new Error('Model name required (e.g. gpt-4o)');
          config = { apiKey: secret.trim(), modelName: openaiModelName.trim() };
        } else {
          if (!localBaseUrl.trim()) throw new Error('Base URL required (e.g. http://localhost:11434/v1)');
          if (!localModelName.trim()) throw new Error('Model name required (e.g. qwen2.5:14b)');
          config = { baseUrl: localBaseUrl.trim(), modelName: localModelName.trim(), ...(secret.trim() ? { apiKey: secret.trim() } : {}) };
        }
        const connType = leadAgentProvider === 'local' ? 'local' : leadAgentProvider;
        return createConnection({ name: setupName.trim() || meta.title, type: connType, purpose: activeSetup, config });
      } else {
        if (!secret.trim() && !meta.secretOptional) throw new Error(`${meta.secretLabel} required`);
        config = { apiKey: secret.trim() };
      }

      return createConnection({ name: setupName.trim() || meta.title, type: meta.type, purpose: activeSetup, config });
```

Note: the last `return createConnection` is only reached for non-lead_agent, non-MCP setups.

- [ ] **Step 4: Add provider picker + conditional fields to SetupModal**

In `SetupModal()`, find the `else` branch of the non-MCP form fields:
```tsx
              ) : (
                <div>
                  <Label>{meta.secretLabel}{meta.secretOptional ? ' (optional)' : ''}</Label>
                  <Input type="password" placeholder={meta.placeholder} value={secret} onChange={e => setSecret(e.target.value)} className="text-sm" />
                  {meta.secretOptionalHint && <p className="mt-1 text-xs text-muted-foreground">{meta.secretOptionalHint}</p>}
                </div>
              )}
```

Replace with:
```tsx
              ) : activeSetup === 'lead_agent' ? (
                <>
                  {/* Provider picker */}
                  <div>
                    <Label>Provider</Label>
                    <div className="mt-1 flex gap-2">
                      {(['anthropic', 'openai', 'local'] as const).map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setLeadAgentProvider(p)}
                          className={cn(
                            'flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                            leadAgentProvider === p
                              ? 'border-primary bg-primary/10 text-foreground'
                              : 'border-border-soft text-muted-foreground hover:bg-muted',
                          )}
                        >
                          {p === 'anthropic' ? 'Claude' : p === 'openai' ? 'OpenAI' : 'Local Model'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Anthropic fields */}
                  {leadAgentProvider === 'anthropic' && (
                    <div>
                      <Label>Anthropic API key</Label>
                      <Input type="password" placeholder="sk-ant-..." value={secret} onChange={e => setSecret(e.target.value)} className="text-sm" />
                    </div>
                  )}

                  {/* OpenAI fields */}
                  {leadAgentProvider === 'openai' && (
                    <>
                      <div>
                        <Label>OpenAI API key</Label>
                        <Input type="password" placeholder="sk-..." value={secret} onChange={e => setSecret(e.target.value)} className="text-sm" />
                      </div>
                      <div>
                        <Label>Model name</Label>
                        <Input placeholder="gpt-4o" value={openaiModelName} onChange={e => setOpenaiModelName(e.target.value)} className="text-sm" />
                      </div>
                    </>
                  )}

                  {/* Local fields */}
                  {leadAgentProvider === 'local' && (
                    <>
                      <div>
                        <Label>Base URL</Label>
                        <Input placeholder="http://localhost:11434/v1" value={localBaseUrl} onChange={e => setLocalBaseUrl(e.target.value)} className="text-sm" />
                      </div>
                      <div>
                        <Label>Model name</Label>
                        <Input placeholder="qwen2.5:14b" value={localModelName} onChange={e => setLocalModelName(e.target.value)} className="text-sm" />
                      </div>
                      <div>
                        <Label>API key (optional)</Label>
                        <Input type="password" placeholder="Leave blank for unauthenticated" value={secret} onChange={e => setSecret(e.target.value)} className="text-sm" />
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div>
                  <Label>{meta.secretLabel}{meta.secretOptional ? ' (optional)' : ''}</Label>
                  <Input type="password" placeholder={meta.placeholder} value={secret} onChange={e => setSecret(e.target.value)} className="text-sm" />
                  {meta.secretOptionalHint && <p className="mt-1 text-xs text-muted-foreground">{meta.secretOptionalHint}</p>}
                </div>
              )}
```

- [ ] **Step 5: Show provider badge on the ConnectionRow for lead_agent**

In `ConnectionRow`, there's a condition that renders `<ConnectedBadge />` when a connection exists. Currently this shows just the connection name. For lead_agent, we can show which provider is active by reading `connection?.type`.

Find inside `ConnectionRow`:
```tsx
              <div className="text-sm text-foreground">{existing.name}</div>
              <ConnectedBadge />
```

Replace with:
```tsx
              <div className="text-sm text-foreground">{existing.name}</div>
              <div className="flex items-center gap-2">
                <ConnectedBadge />
                {kind === 'lead_agent' && existing.type && (
                  <span className="text-xs text-muted-foreground">
                    {existing.type === 'local' ? 'local model' : existing.type === 'openai' ? 'OpenAI' : 'Claude'}
                  </span>
                )}
              </div>
```

Note: the `Connection` type will need a `type` field exposed from the API if it isn't already. Check `web/src/types.ts` for the `Connection` interface. If `type` isn't in the API response, this step can be simplified to just skip the badge (the `existing.type` will be `undefined` and the span won't render).

- [ ] **Step 6: Check Connection type in types.ts**

```bash
grep -n "Connection\b" /Users/zack/Documents/GitHub/unnamedproject/web/src/types.ts | head -10
```

If `Connection` has no `type` field, add it:
```ts
type: string;
```

Also check the `/connections` API handler to verify it returns `type`. If it does, no backend change needed.

- [ ] **Step 7: Test in browser**

Start the dev server:
```bash
cd web && npm run dev
```

1. Go to Settings → Agents tab.
2. Click "Connect" on the Lead Agent row.
3. The modal should show three buttons: `Claude`, `OpenAI`, `Local Model`.
4. Clicking `Claude` shows the Anthropic API key field (existing behavior).
5. Clicking `OpenAI` shows API key + Model name fields.
6. Clicking `Local Model` shows Base URL + Model name + optional API key.
7. Save with OpenAI selected (using test values) and verify the modal closes and the row shows "OpenAI" badge.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Settings.tsx
git commit -m "feat(settings): add provider picker for lead agent (Claude, OpenAI, Local Model)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered? |
|-----------------|---------|
| Claude / OpenAI / Local provider | Task 5 (providers file) |
| DB: `'local'` type | Task 2 |
| `connections.ts` relaxed for `lead_agent` | Task 3 |
| `getLeadAgentConnection()` typed union | Task 4 |
| Format translation: tools | Task 5, `toOpenAITools` |
| Format translation: messages | Task 5, `toOpenAIMessages` |
| Format translation: response back to Anthropic blocks | Task 5, OpenAICompatibleProvider.stream() |
| Streaming text deltas to client | Task 5 + Task 6, `onText` callback |
| Turn loop unchanged | Task 6 (same retry, abort, tool dispatch) |
| Model resolution per provider | Task 5, `resolveModel` on each class |
| Settings UI provider picker | Task 7 |
| Test connection for local endpoint | Task 3, Step 2 |
| openai SDK installed | Task 1 |

**Placeholder scan:** None found — all steps contain actual code.

**Type consistency check:**
- `contentBlocks: Anthropic.ContentBlock[]` — returned by `provider.stream()`, consumed by `runAgentTurn` as `currentMessages.push({ role: 'assistant', content: contentBlocks })`. The `Anthropic.MessageParam` content type accepts `ContentBlock[]`. ✓
- `toolUseBlocks` filtered from `contentBlocks` (same type as before). ✓
- `model` is `string` throughout; `provider.resolveModel()` returns `Promise<string>`. ✓
- `getLeadAgentConnection` returns `LeadAgentConnection`; `getLeadAgentProvider` reads it and constructs the right class. ✓
