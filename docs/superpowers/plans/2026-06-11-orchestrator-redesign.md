# Orchestrator Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic system prompt with a parallel Haiku intent pre-pass, composable context blocks, per-turn model routing, selective memory recall, tool subsetting, and background memory/distillation jobs.

**Architecture:** A Haiku intent extraction call runs in parallel with model-list pre-warming on every turn; the result drives system prompt assembly from domain-specific blocks, per-turn model selection capped by session effort ceiling, and a filtered tool subset. Post-turn fire-and-forget jobs handle automatic memory extraction and session distillation.

**Tech Stack:** TypeScript, Node.js, `@anthropic-ai/sdk`, better-sqlite3 (sync API), vitest

---

## File Structure

**New files:**
- `server/src/services/intent.ts` — `Intent` type + `extractIntent` (Haiku call) + `extractIntentWithClient` (testable)
- `server/src/services/context.ts` — `buildContext(userId, sessionId, intent)` + `getToolSubset(intent)`
- `server/src/services/extract-memory.ts` — `extractAndRemember(userId, sessionId, apiKey)` background job
- `server/src/services/distill.ts` — `maybeDistill(userId, sessionId, apiKey)` background job
- `server/tests/services/intent.test.ts`
- `server/tests/services/context.test.ts`

**Modified files:**
- `server/src/db/index.ts` — add `summary TEXT` migration for sessions
- `server/src/services/memory.ts` — add `recallRelevant(userId, intent, pinnedProjectId?)` + `scoreMemory`
- `server/src/services/anthropic.ts` — add `resolveModelForTurn(client, intent, effort, apiKey?)`
- `server/src/services/agent.ts` — wire all new services; replace `buildSystemPrompt`; add background jobs
- `server/tests/services/memory.test.ts` — add `recallRelevant` tests
- `server/tests/services/anthropic.test.ts` — add `resolveModelForTurn` tests

**Unchanged:** `server/src/tools/definitions.ts`, `server/src/tools/*`, `dispatchTool` switch in agent.ts

---

## Task 1: DB — add `summary` column to sessions

**Files:**
- Modify: `server/src/db/index.ts`
- Test: `server/tests/db.test.ts`

- [ ] **Step 1: Read the existing migration guard pattern**

Open `server/src/db/index.ts` and find the block starting at line ~196 that guards the `effort`, `model`, and `pinned_project_id` column additions. The pattern is:
```ts
const sessionCols = db.prepare("SELECT name FROM pragma_table_info('sessions')").all() as { name: string }[];
if (!sessionCols.some(c => c.name === 'effort')) { ... }
```
You will add a new guard immediately after the existing `pinned_project_id` guard (~line 205).

- [ ] **Step 2: Write the failing test**

In `server/tests/db.test.ts`, add at the end of the file:

```ts
it('sessions table has a summary column', () => {
  const cols = getDb()
    .prepare("SELECT name FROM pragma_table_info('sessions')")
    .all() as { name: string }[];
  expect(cols.some(c => c.name === 'summary')).toBe(true);
});
```

- [ ] **Step 3: Run the test and confirm it fails**

```bash
cd server && npx vitest run tests/db.test.ts
```

Expected: FAIL — `summary` column does not exist yet.

- [ ] **Step 4: Add the migration to `server/src/db/index.ts`**

After the `pinned_project_id` guard block, add:

```ts
if (!sessionCols.some(c => c.name === 'summary')) {
  db.exec('ALTER TABLE sessions ADD COLUMN summary TEXT');
}
```

- [ ] **Step 5: Run the test and confirm it passes**

```bash
cd server && npx vitest run tests/db.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/db/index.ts server/tests/db.test.ts
git commit -m "feat: add summary column to sessions for distillation"
```

---

## Task 2: Intent extraction service

**Files:**
- Create: `server/src/services/intent.ts`
- Create: `server/tests/services/intent.test.ts`

- [ ] **Step 1: Create the test file**

Create `server/tests/services/intent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { extractIntentWithClient, DEFAULT_INTENT } from '../../src/services/intent.js';

function mockClient(responseText: string): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  } as unknown as Anthropic;
}

describe('extractIntentWithClient', () => {
  it('parses a valid intent response', async () => {
    const json = JSON.stringify({
      domain: 'code',
      complexity: 'medium',
      model: 'sonnet',
      tools: ['invoke_claude_code'],
      scope: 'delegate',
      needs_research: false,
      ambiguous: false,
    });
    const result = await extractIntentWithClient('build me a login page', mockClient(json));
    expect(result.domain).toBe('code');
    expect(result.scope).toBe('delegate');
    expect(result.ambiguous).toBe(false);
    expect(result.tools).toContain('invoke_claude_code');
  });

  it('returns DEFAULT_INTENT when the response is not valid JSON', async () => {
    const result = await extractIntentWithClient('hello', mockClient('not json at all'));
    expect(result).toEqual(DEFAULT_INTENT);
  });

  it('returns DEFAULT_INTENT when the API call throws', async () => {
    const broken: Anthropic = {
      messages: {
        create: async () => { throw new Error('network error'); },
      },
    } as unknown as Anthropic;
    const result = await extractIntentWithClient('anything', broken);
    expect(result).toEqual(DEFAULT_INTENT);
  });

  it('fills in missing fields with defaults on partial response', async () => {
    const partial = JSON.stringify({ domain: 'writing' }); // missing most fields
    const result = await extractIntentWithClient('write an email', mockClient(partial));
    expect(result.domain).toBe('writing');
    expect(result.complexity).toBe(DEFAULT_INTENT.complexity);
    expect(result.model).toBe(DEFAULT_INTENT.model);
    expect(result.scope).toBe(DEFAULT_INTENT.scope);
    expect(result.needs_research).toBe(false);
  });

  it('truncates very long messages to 1000 chars before sending', async () => {
    let capturedContent = '';
    const spy: Anthropic = {
      messages: {
        create: async (params: { messages: Array<{ content: string }> }) => {
          capturedContent = params.messages[0].content;
          return { content: [{ type: 'text', text: JSON.stringify(DEFAULT_INTENT) }] };
        },
      },
    } as unknown as Anthropic;
    await extractIntentWithClient('x'.repeat(5000), spy);
    expect(capturedContent.length).toBeLessThanOrEqual(1000);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd server && npx vitest run tests/services/intent.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `server/src/services/intent.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';

export interface Intent {
  domain: 'code' | 'writing' | 'research' | 'creative' | 'image' | 'multi' | 'general';
  complexity: 'low' | 'medium' | 'high';
  model: 'haiku' | 'sonnet' | 'fable' | 'opus';
  tools: string[];
  scope: 'inline' | 'delegate' | 'campaign';
  needs_research: boolean;
  ambiguous: boolean;
}

export const DEFAULT_INTENT: Intent = {
  domain: 'general',
  complexity: 'medium',
  model: 'sonnet',
  tools: [],
  scope: 'inline',
  needs_research: false,
  ambiguous: true,
};

const INTENT_SYSTEM = `You are a routing classifier. Given a user message, output JSON only — no prose, no markdown.

Return exactly this shape:
{"domain":"code|writing|research|creative|image|multi|general","complexity":"low|medium|high","model":"haiku|sonnet|fable|opus","tools":[],"scope":"inline|delegate|campaign","needs_research":false,"ambiguous":false}

Domain:
- code: coding, debugging, refactoring, software projects
- writing: drafts, docs, essays, emails, specs
- research: questions, lookups, fact-finding, comparisons
- creative: stories, poetry, brainstorming, creative content (non-image)
- image: image generation requests
- multi: clearly spans multiple domains
- general: unclear, conversational, or greeting

Complexity:
- low: quick answer, trivial edit, single file
- medium: a feature, a few files, standard work
- high: architecture, large refactor, multi-system coordination

Model:
- haiku: any low complexity
- sonnet: medium complexity anything
- fable: high complexity creative or writing
- opus: high complexity code, architecture, or deep analysis

Scope:
- inline: respond directly with no tool delegation
- delegate: one coding or creative agent call
- campaign: multiple independent or sequenced tasks

tools: hint at likely tools from: invoke_claude_code, invoke_codex, git_op, github_api, web_search, web_fetch, write_file, read_file, image_gen

Set ambiguous=true and use general/medium/sonnet/inline defaults when the message is unclear.`;

export async function extractIntentWithClient(userMessage: string, client: Anthropic): Promise<Intent> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: INTENT_SYSTEM,
      messages: [{ role: 'user', content: userMessage.slice(0, 1000) }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const parsed = JSON.parse(text) as Partial<Intent>;
    return {
      domain: (['code','writing','research','creative','image','multi','general'] as const).includes(parsed.domain as never)
        ? parsed.domain as Intent['domain']
        : DEFAULT_INTENT.domain,
      complexity: (['low','medium','high'] as const).includes(parsed.complexity as never)
        ? parsed.complexity as Intent['complexity']
        : DEFAULT_INTENT.complexity,
      model: (['haiku','sonnet','fable','opus'] as const).includes(parsed.model as never)
        ? parsed.model as Intent['model']
        : DEFAULT_INTENT.model,
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
      scope: (['inline','delegate','campaign'] as const).includes(parsed.scope as never)
        ? parsed.scope as Intent['scope']
        : DEFAULT_INTENT.scope,
      needs_research: typeof parsed.needs_research === 'boolean' ? parsed.needs_research : false,
      ambiguous: typeof parsed.ambiguous === 'boolean' ? parsed.ambiguous : false,
    };
  } catch {
    return { ...DEFAULT_INTENT };
  }
}

export async function extractIntent(userMessage: string, apiKey: string): Promise<Intent> {
  return extractIntentWithClient(userMessage, new Anthropic({ apiKey }));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd server && npx vitest run tests/services/intent.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/intent.ts server/tests/services/intent.test.ts
git commit -m "feat: add intent extraction pre-pass service"
```

---

## Task 3: Per-turn model routing

**Files:**
- Modify: `server/src/services/anthropic.ts`
- Modify: `server/tests/services/anthropic.test.ts`

- [ ] **Step 1: Write the failing tests**

In `server/tests/services/anthropic.test.ts`, add after the existing describe block:

```ts
import { resolveModelForTurn } from '../../src/services/anthropic.js';
import type { Intent } from '../../src/services/intent.js';

const sonnetIntent: Intent = {
  domain: 'code', complexity: 'medium', model: 'sonnet',
  tools: [], scope: 'delegate', needs_research: false, ambiguous: false,
};
const haikusIntent: Intent = {
  domain: 'research', complexity: 'low', model: 'haiku',
  tools: [], scope: 'inline', needs_research: false, ambiguous: false,
};
const opusIntent: Intent = {
  domain: 'code', complexity: 'high', model: 'opus',
  tools: [], scope: 'campaign', needs_research: false, ambiguous: false,
};

describe('resolveModelForTurn', () => {
  it('picks the model family from intent', async () => {
    const client = mockClient([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);
    await expect(resolveModelForTurn(client, sonnetIntent, 'high')).resolves.toBe('claude-sonnet-4-6');
    await expect(resolveModelForTurn(client, haikusIntent, 'high')).resolves.toBe('claude-haiku-4-5-20251001');
    await expect(resolveModelForTurn(client, opusIntent, 'high')).resolves.toBe('claude-opus-4-8');
  });

  it('applies effort ceiling: medium effort caps at sonnet', async () => {
    const client = mockClient(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    // opus intent but session effort is medium → capped at sonnet
    await expect(resolveModelForTurn(client, opusIntent, 'medium')).resolves.toBe('claude-sonnet-4-6');
  });

  it('applies effort ceiling: low effort caps at haiku', async () => {
    const client = mockClient(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    await expect(resolveModelForTurn(client, opusIntent, 'low')).resolves.toBe('claude-haiku-4-5-20251001');
    await expect(resolveModelForTurn(client, sonnetIntent, 'low')).resolves.toBe('claude-haiku-4-5-20251001');
  });

  it('falls back to DEFAULT_CLAUDE_MODEL when no matching family found', async () => {
    const client = mockClient(['claude-sonnet-4-6']); // no haiku
    const result = await resolveModelForTurn(client, haikusIntent, 'high');
    // falls back — sonnet is closest or default
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd server && npx vitest run tests/services/anthropic.test.ts
```

Expected: FAIL — `resolveModelForTurn` not exported.

- [ ] **Step 3: Add `resolveModelForTurn` to `server/src/services/anthropic.ts`**

Add after `resolveModelForEffort`:

```ts
const FAMILY_TIER: Record<string, number> = { haiku: 0, sonnet: 1, fable: 2, opus: 3 };
const MAX_TIER_BY_EFFORT: Record<EffortLevel, number> = { low: 0, medium: 1, high: 3 };
const TIER_FAMILY = ['haiku', 'sonnet', 'fable', 'opus'] as const;

export async function resolveModelForTurn(
  client: Anthropic,
  intent: { model: string },
  effort: EffortLevel,
  apiKey?: string,
): Promise<string> {
  const intentTier = FAMILY_TIER[intent.model] ?? 1;
  const ceiling = MAX_TIER_BY_EFFORT[effort];
  const effectiveTier = Math.min(intentTier, ceiling);
  const family = TIER_FAMILY[effectiveTier];

  const envOverride = MODEL_OVERRIDE_BY_EFFORT[effort];
  if (envOverride && effectiveTier === ceiling) return envOverride;

  try {
    const models = await listClaudeModelsForClient(client, apiKey);
    const matching = models
      .filter(m => m.id.startsWith('claude-') && m.id.toLowerCase().includes(family))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (matching[0]) return matching[0].id;
    // Fallback: use the highest-ranked model within the ceiling
    const ranked = rankModels(models, effort);
    return ranked[0]?.id ?? DEFAULT_CLAUDE_MODEL;
  } catch {
    return DEFAULT_CLAUDE_MODEL;
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd server && npx vitest run tests/services/anthropic.test.ts
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/anthropic.ts server/tests/services/anthropic.test.ts
git commit -m "feat: add per-turn model routing with effort ceiling"
```

---

## Task 4: Memory selective recall

**Files:**
- Modify: `server/src/services/memory.ts`
- Modify: `server/tests/services/memory.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/services/memory.test.ts`:

```ts
import { recallRelevant } from '../../src/services/memory.js';
import type { Intent } from '../../src/services/intent.js';

const codeIntent: Intent = {
  domain: 'code', complexity: 'medium', model: 'sonnet',
  tools: ['invoke_claude_code', 'git_op'], scope: 'delegate',
  needs_research: false, ambiguous: false,
};
const researchIntent: Intent = {
  domain: 'research', complexity: 'low', model: 'haiku',
  tools: ['web_search'], scope: 'inline',
  needs_research: false, ambiguous: false,
};

describe('recallRelevant', () => {
  const relUserId = newId();

  beforeAll(() => {
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(relUserId, `rel-${relUserId}@test.com`, 'x');
    rememberFact(relUserId, 'feedback', 'always_commit', 'commit after every change');
    rememberFact(relUserId, 'user', 'preferred_language', 'TypeScript');
    rememberFact(relUserId, 'user', 'slack_workspace', 'company.slack.com');
    rememberFact(relUserId, 'reference', 'bug_tracker', 'Linear INGEST project for pipeline bugs');
    rememberFact(relUserId, 'reference', 'design_system', 'Figma link for UI components');
  });

  it('always includes all feedback entries', () => {
    const result = recallRelevant(relUserId, researchIntent);
    expect(result.some(e => e.type === 'feedback' && e.key === 'always_commit')).toBe(true);
  });

  it('scores user memories by domain relevance', () => {
    const result = recallRelevant(relUserId, codeIntent);
    // 'preferred_language' contains 'TypeScript' — relevant to code domain
    const keys = result.map(e => e.key);
    expect(keys).toContain('preferred_language');
  });

  it('filters project memories to pinned project when provided', () => {
    const projectId = newId();
    getDb().prepare('INSERT INTO projects (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)').run(projectId, relUserId, `proj-${relUserId}`, '[]');
    rememberFact(relUserId, 'project', 'auth_decision', 'using JWT with RS256', projectId);
    rememberFact(relUserId, 'project', 'other_note', 'unrelated project fact');

    const withPin = recallRelevant(relUserId, codeIntent, projectId);
    expect(withPin.some(e => e.type === 'project' && e.key === 'auth_decision')).toBe(true);
    // other project memory without matching project_id is excluded
    expect(withPin.some(e => e.type === 'project' && e.key === 'other_note')).toBe(false);
  });

  it('caps user memories at 10 entries', () => {
    const bigUserId = newId();
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(bigUserId, `big-${bigUserId}@test.com`, 'x');
    for (let i = 0; i < 15; i++) {
      rememberFact(bigUserId, 'user', `key_${i}`, `value ${i}`);
    }
    const result = recallRelevant(bigUserId, codeIntent);
    expect(result.filter(e => e.type === 'user').length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd server && npx vitest run tests/services/memory.test.ts
```

Expected: FAIL — `recallRelevant` not exported.

- [ ] **Step 3: Add `recallRelevant` and `scoreMemory` to `server/src/services/memory.ts`**

Add at the end of the file (after existing exports). Note: use a type-only import to avoid circular dependencies:

```ts
import type { Intent } from './intent.js';

const MAX_USER_MEMORIES = 10;

function scoreMemory(entry: MemoryEntry, intent: Intent): number {
  const text = `${entry.key} ${entry.value}`.toLowerCase();
  let score = 0;
  if (text.includes(intent.domain)) score += 2;
  for (const tool of intent.tools) {
    const normalized = tool.toLowerCase().replace(/_/g, ' ');
    if (text.includes(normalized) || text.includes(tool.toLowerCase())) score += 1;
  }
  return score;
}

export function recallRelevant(userId: string, intent: Intent, pinnedProjectId?: string): MemoryEntry[] {
  const all = recallAll(userId);

  const feedback = all.filter(e => e.type === 'feedback');

  const project = pinnedProjectId
    ? all.filter(e => e.type === 'project' && e.project_id === pinnedProjectId)
    : all.filter(e => e.type === 'project' && scoreMemory(e, intent) > 0);

  const reference = intent.domain === 'general'
    ? all.filter(e => e.type === 'reference')
    : all.filter(e => e.type === 'reference' && scoreMemory(e, intent) > 0);

  const user = all
    .filter(e => e.type === 'user')
    .map(e => ({ entry: e, score: scoreMemory(e, intent) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_USER_MEMORIES)
    .map(s => s.entry);

  return [...feedback, ...project, ...reference, ...user];
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd server && npx vitest run tests/services/memory.test.ts
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/memory.ts server/tests/services/memory.test.ts
git commit -m "feat: add selective memory recall scored by intent"
```

---

## Task 5: Context block assembly

**Files:**
- Create: `server/src/services/context.ts`
- Create: `server/tests/services/context.test.ts`

- [ ] **Step 1: Create the test file**

Create `server/tests/services/context.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { buildContext, getToolSubset } from '../../src/services/context.js';
import { DEFAULT_INTENT } from '../../src/services/intent.js';
import type { Intent } from '../../src/services/intent.js';
import { toolDefinitions } from '../../src/tools/definitions.js';

const userId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `ctx-${userId}@test.com`, 'x');
  sessionId = newId();
  getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
});

const codeIntent: Intent = { ...DEFAULT_INTENT, domain: 'code', scope: 'delegate' };
const writingIntent: Intent = { ...DEFAULT_INTENT, domain: 'writing', scope: 'inline' };
const researchIntent: Intent = { ...DEFAULT_INTENT, domain: 'research', scope: 'inline' };

describe('buildContext', () => {
  it('always includes base identity and approval tier content', () => {
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('orchestrator');
    expect(ctx).toContain('auto-approved');
  });

  it('always includes research discipline block', () => {
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('web_fetch');
    expect(ctx).toContain('web_search');
  });

  it('includes worktree isolation guidance for code domain', () => {
    const ctx = buildContext(userId, sessionId, codeIntent);
    expect(ctx).toContain('worktree');
    expect(ctx).toContain('invoke_claude_code');
  });

  it('includes write_file guidance for writing domain', () => {
    const ctx = buildContext(userId, sessionId, writingIntent);
    expect(ctx).toContain('write_file');
    expect(ctx).not.toContain('invoke_claude_code');
  });

  it('includes citation guidance for research domain', () => {
    const ctx = buildContext(userId, sessionId, researchIntent);
    expect(ctx).toContain('Cite');
  });

  it('includes session summary when present', () => {
    getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run('Earlier we discussed auth', sessionId);
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('Earlier we discussed auth');
    // cleanup
    getDb().prepare('UPDATE sessions SET summary = NULL WHERE id = ?').run(sessionId);
  });
});

describe('getToolSubset', () => {
  const allToolNames = toolDefinitions.map(t => t.name);

  it('code domain includes invoke_claude_code and git_op', () => {
    const tools = getToolSubset(codeIntent);
    const names = tools.map(t => t.name);
    expect(names).toContain('invoke_claude_code');
    expect(names).toContain('git_op');
  });

  it('code domain includes web_search (research tools are universal)', () => {
    const tools = getToolSubset(codeIntent);
    expect(tools.map(t => t.name)).toContain('web_search');
  });

  it('writing domain excludes invoke_claude_code', () => {
    const tools = getToolSubset(writingIntent);
    expect(tools.map(t => t.name)).not.toContain('invoke_claude_code');
  });

  it('research domain excludes invoke_claude_code and git_op', () => {
    const tools = getToolSubset(researchIntent);
    const names = tools.map(t => t.name);
    expect(names).not.toContain('invoke_claude_code');
    expect(names).not.toContain('git_op');
  });

  it('general domain returns all tools', () => {
    const tools = getToolSubset(DEFAULT_INTENT); // domain=general
    expect(tools.length).toBe(allToolNames.length);
  });

  it('multi domain returns all tools', () => {
    const multiIntent: Intent = { ...DEFAULT_INTENT, domain: 'multi' };
    const tools = getToolSubset(multiIntent);
    expect(tools.length).toBe(allToolNames.length);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd server && npx vitest run tests/services/context.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `server/src/services/context.ts`**

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { getDb, type DbProject } from '../db/index.js';
import { recallRelevant } from './memory.js';
import { formatEntry } from '../tools/memory_tools.js';
import { toolDefinitions } from '../tools/definitions.js';
import type { Intent } from './intent.js';

// ─── Block builders ────────────────────────────────────────────────────────

function baseBlock(): string {
  return `You are a personal AI operator and orchestrator. You decide how work gets done — you never implement code, write files, or run git operations yourself when the task belongs to a coding agent.

## Core rules
- Auto-approved (do without asking): invoke_claude_code, invoke_codex, git_op add/commit, create_project, project_query, rebuild_graph, read_file, list_dir, recall, remember, forget, create_campaign
- User-approved (proceed and the system handles the pause): git_op push, write_file, github_api write ops, delete_project
- If a task has multiple coordinated workstreams: call create_campaign first, then dispatch tasks with their campaign_task_id. Never dispatch parallel agents without a campaign tracking them.
- Never ask the user for permission on an auto-approved action — just do it.`;
}

function researchBlock(): string {
  return `## Research discipline
web_search returns snippet previews only — always follow with web_fetch to read the full page before drawing conclusions.
Use recall before searching; the answer may already be in memory.
When a coding task requires external knowledge (library APIs, patterns, examples): complete the research pass first and include findings in the agent brief.`;
}

function domainBlock(intent: Intent): string {
  switch (intent.domain) {
    case 'code':
      return `## Coding tasks
Worktree isolation: coding agents work on an isolated branch — the user's main checkout is never touched.

Scoping rules — choose the right unit of work:
- One coherent feature with clear scope → one ambitious invoke_claude_code prompt (describe what exists, what to build, what "done" means including tests passing)
- Independent parallel workstreams → campaign with parallel tasks
- Strict ordering (e.g. schema → API → frontend) → campaign with sequenced tasks
- Never break a coherent task into multiple small round-trips — it wastes context and loses continuity

Sub-agent model hints (pass as model param to invoke_claude_code):
- 'haiku': trivial edits, single-file changes
- 'sonnet': standard feature work (default)
- 'opus': architectural decisions, large refactors, complex multi-file reasoning

Agent brief quality: always include — what already exists (from project_query or research), what to build, and what "done" means.

Result evaluation: after invoke_claude_code or invoke_codex returns, read the result for failure signals (test failures, errors, "could not", partial completion). If present, send a targeted follow-up correction before committing. On confirmed success: run git_op add then git_op commit. Do not ask permission to commit.

Prefer invoke_claude_code. Use invoke_codex for OpenAI preference or a parallel second approach.`;

    case 'writing':
      return `## Writing tasks
Use write_file for output to save; respond inline for drafts the user has not asked to save.
Confirm path and project with the user before writing any file.
Do not invoke coding agents for writing, documentation, or note-taking tasks.`;

    case 'research':
      return `## Research tasks
Always read the full source — web_search alone is insufficient, always follow with web_fetch.
Cite sources in your response.
Check recall first before any web search.`;

    case 'creative':
      return `## Creative tasks
Respond inline for short creative work. Use write_file when the user wants output saved.
Research often improves creative work — check for relevant context before generating.`;

    case 'multi':
      return `## Multi-domain tasks
Always use create_campaign to track coordinated work before dispatching any tasks.
Suggested order: research → setup → implementation → verification → git → github.`;

    default:
      return '';
  }
}

function projectContextBlock(project: DbProject): string {
  const isCode = !!project.repo_path;
  const header = `## Active project: **${project.name}** (id: ${project.id})${project.description ? ' — ' + project.description : ''}`;
  const guidance = isCode
    ? `\nCode project (repo: ${project.repo_path}). Delegate coding tasks to invoke_claude_code or invoke_codex with full context. Use git_op add→commit after work completes. For non-code tasks (docs, notes), use write_file/read_file directly.`
    : `\nDoc/writing project (no git repo). Use write_file/read_file/list_dir directly — no Claude Code or Codex needed. Create files in this project for any output the user wants saved.`;
  return header + guidance;
}

function memoryBlock(userId: string, intent: Intent, pinnedProjectId?: string): string {
  const entries = recallRelevant(userId, intent, pinnedProjectId);
  if (entries.length === 0) return 'User memory:\nNo memories stored yet.';
  return `User memory:\n${entries.map(e => `- ${formatEntry(userId, e)}`).join('\n')}`;
}

function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff <= 0) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function recentChatsBlock(userId: string, sessionId: string): string {
  const chats = getDb()
    .prepare('SELECT id, title, updated_at FROM sessions WHERE user_id = ? AND id != ? ORDER BY updated_at DESC LIMIT 10')
    .all(userId, sessionId) as Array<{ id: string; title: string | null; updated_at: number }>;
  if (chats.length === 0) return '';
  return `Recent chats (use read_chat to retrieve full context when relevant):\n${chats.map(c => `- "${c.title ?? 'Untitled'}" (id: ${c.id}, ${timeAgo(c.updated_at)})`).join('\n')}`;
}

function projectsListBlock(userId: string): string {
  const projects = getDb()
    .prepare('SELECT id, name, description, repo_path FROM projects WHERE user_id = ?')
    .all(userId) as Array<{ id: string; name: string; description: string | null; repo_path: string | null }>;
  if (projects.length === 0) return 'No projects yet.';
  return `Available projects:\n${projects.map(p => `- ${p.name} (id: ${p.id}${p.repo_path ? '' : ', no repo'})${p.description ? ': ' + p.description : ''}`).join('\n')}`;
}

function sessionSummaryBlock(sessionId: string): string {
  const row = getDb()
    .prepare('SELECT summary FROM sessions WHERE id = ?')
    .get(sessionId) as { summary: string | null } | undefined;
  if (!row?.summary) return '';
  return `Earlier in this session:\n${row.summary}`;
}

// ─── Public API ────────────────────────────────────────────────────────────

export function buildContext(userId: string, sessionId: string, intent: Intent): string {
  const session = getDb()
    .prepare('SELECT pinned_project_id FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_project_id: string | null } | undefined;
  const pinnedProjectId = session?.pinned_project_id ?? undefined;

  const pinnedProject = pinnedProjectId
    ? getDb().prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE id = ?')
        .get(pinnedProjectId) as DbProject | undefined
    : undefined;

  const blocks: string[] = [
    baseBlock(),
    researchBlock(),
  ];

  const domain = domainBlock(intent);
  if (domain) blocks.push(domain);

  if (pinnedProject) blocks.push(projectContextBlock(pinnedProject));

  blocks.push(memoryBlock(userId, intent, pinnedProjectId));
  blocks.push(projectsListBlock(userId));

  const chats = recentChatsBlock(userId, sessionId);
  if (chats) blocks.push(chats);

  const summary = sessionSummaryBlock(sessionId);
  if (summary) blocks.push(summary);

  return blocks.join('\n\n');
}

// ─── Tool subsetting ───────────────────────────────────────────────────────

const TOOL_SETS: Record<string, string[]> = {
  code: [
    'invoke_claude_code', 'invoke_codex', 'git_op', 'github_api',
    'project_query', 'rebuild_graph', 'create_campaign',
    'read_file', 'list_dir', 'write_file', 'create_project', 'update_project',
    'remember', 'recall', 'forget', 'read_chat',
    'web_search', 'web_fetch',
  ],
  writing: [
    'write_file', 'read_file', 'list_dir', 'create_project', 'update_project',
    'web_search', 'web_fetch', 'remember', 'recall', 'forget', 'read_chat',
  ],
  research: [
    'web_search', 'web_fetch', 'recall', 'remember', 'forget',
    'read_chat', 'read_file', 'write_file',
  ],
  creative: [
    'write_file', 'read_file', 'create_project',
    'web_search', 'web_fetch', 'remember', 'recall', 'forget', 'read_chat',
  ],
};

export function getToolSubset(intent: Intent): Anthropic.Tool[] {
  const allowed = TOOL_SETS[intent.domain];
  if (!allowed) return toolDefinitions; // multi, general, image → all tools
  return toolDefinitions.filter(t => allowed.includes(t.name));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd server && npx vitest run tests/services/context.test.ts
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/context.ts server/tests/services/context.test.ts
git commit -m "feat: add composable context block assembly and tool subsetting"
```

---

## Task 6: Wire agent loop — intent, context, model routing

**Files:**
- Modify: `server/src/services/agent.ts`

This is the integration step. `buildSystemPrompt` is deleted and replaced with `buildContext`. `resolveModelForEffort` is replaced with `resolveModelForTurn`. The intent pre-pass is added. Session model override is preserved.

- [ ] **Step 1: Add imports to `server/src/services/agent.ts`**

At the top of the imports section, add:

```ts
import { extractIntent, DEFAULT_INTENT } from './intent.js';
import { buildContext, getToolSubset } from './context.js';
import { resolveModelForTurn } from './anthropic.js';
import { listClaudeModels } from './anthropic.js';
```

Remove the existing import of `recallAll` from `./memory.js` (it's no longer used directly in agent.ts).

- [ ] **Step 2: Delete `buildSystemPrompt` from `server/src/services/agent.ts`**

Remove the entire `buildSystemPrompt` function (lines 86–151). It is fully replaced by `buildContext` in `context.ts`.

- [ ] **Step 3: Replace the setup section at the top of `runAgentTurn`**

Find the block in `runAgentTurn` from `const session = getDb()...` through `const systemPrompt = buildSystemPrompt(...)` and `const model = session?.model || await resolveModelForEffort(...)`.

Replace it with:

```ts
const session = getDb()
  .prepare('SELECT effort, model, summary FROM sessions WHERE id = ?')
  .get(sessionId) as { effort: EffortLevel; model: string | null; summary: string | null } | undefined;
const effort = session?.effort ?? DEFAULT_EFFORT;

const history = getDb()
  .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at')
  .all(sessionId) as DbMessage[];

// Extract the last user message for intent classification
const lastUserMsg = [...history].reverse().find(m => m.role === 'user')?.content ?? '';

// Run intent extraction and model-list cache warm-up in parallel
const [intent] = await Promise.all([
  extractIntent(lastUserMsg, apiKey).catch(() => ({ ...DEFAULT_INTENT })),
  listClaudeModels(userId).catch(() => {}), // pre-warms the 5-min cache, result unused
]);

// Explicit session model always wins; otherwise use per-turn routing with effort ceiling
const model = session?.model ?? await resolveModelForTurn(client, intent, effort, apiKey);

// Assemble context and tool subset from intent
const systemPrompt = buildContext(userId, sessionId, intent);
const tools = getToolSubset(intent);
```

- [ ] **Step 4: Update the `client.messages.stream` call to use the new `tools` variable**

Find:
```ts
const stream = client.messages.stream({
  model,
  max_tokens: 8192,
  system: systemPrompt,
  tools: toolDefinitions,
  messages: currentMessages,
}, {
```

Replace `tools: toolDefinitions` with `tools: tools`.

- [ ] **Step 5: Remove the now-unused `toolDefinitions` import**

Find the import line for `toolDefinitions` in the imports section and remove it.

- [ ] **Step 6: Run the full test suite and confirm nothing is broken**

```bash
cd server && npx vitest run
```

Expected: all tests passing. (No new tests needed for this step — the context and intent tests already cover the new code paths.)

- [ ] **Step 7: Commit**

```bash
git add server/src/services/agent.ts
git commit -m "feat: wire intent extraction, per-turn model routing, and composable context into agent loop"
```

---

## Task 7: Auto memory extraction background job

**Files:**
- Create: `server/src/services/extract-memory.ts`
- Modify: `server/src/services/agent.ts`

- [ ] **Step 1: Create `server/src/services/extract-memory.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { rememberFact } from './memory.js';
import type { MemoryType } from './memory.js';

interface MemoryCandidate {
  type: MemoryType;
  key: string;
  value: string;
  project_id?: string;
}

const EXTRACT_SYSTEM = `You are a memory extractor. Review the conversation and identify facts worth persisting for future sessions. Return a JSON array of memory candidates — or an empty array [] if nothing new is worth saving.

Each candidate:
{"type":"user|feedback|project|reference","key":"short_snake_case_id","value":"the fact","project_id":"optional"}

Types:
- user: durable preferences or facts about the user or their environment
- feedback: corrections or process preferences about how the assistant should work
- project: decisions or notes tied to a specific project (include project_id)
- reference: pointers to external systems (Slack channels, Linear projects, dashboards, etc.)

Only extract genuinely new and durable information. Do not re-extract things that are already common knowledge or temporary context. Return [] if nothing qualifies.`;

export async function extractAndRemember(userId: string, sessionId: string, apiKey: string): Promise<void> {
  const messages = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(sessionId) as Array<{ role: string; content: string }>;

  if (messages.length === 0) return;

  const session = getDb()
    .prepare('SELECT pinned_project_id FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_project_id: string | null } | undefined;

  const transcript = messages
    .reverse()
    .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
    .join('\n\n');

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: transcript }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]';
    const candidates = JSON.parse(text) as MemoryCandidate[];

    for (const c of candidates) {
      if (!c.type || !c.key || !c.value) continue;
      const projectId = c.project_id ?? session?.pinned_project_id ?? null;
      rememberFact(userId, c.type, c.key, c.value, projectId);
    }
  } catch {
    // extraction is best-effort, never throw
  }
}
```

- [ ] **Step 2: Wire into agent.ts — add import and fire-and-forget call**

Add import at the top of `server/src/services/agent.ts`:

```ts
import { extractAndRemember } from './extract-memory.js';
```

At the very end of `runAgentTurn`, after the `maybeGenerateSessionTitle` call, add:

```ts
extractAndRemember(userId, sessionId, apiKey).catch(() => {});
```

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

```bash
cd server && npx vitest run
```

Expected: all tests passing.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/extract-memory.ts server/src/services/agent.ts
git commit -m "feat: add background auto memory extraction after each turn"
```

---

## Task 8: Session distillation background job

**Files:**
- Create: `server/src/services/distill.ts`
- Modify: `server/src/services/agent.ts`

- [ ] **Step 1: Write the failing test**

Create `server/tests/services/distill.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { shouldDistill, getTurnCount } from '../../src/services/distill.js';

const userId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `dist-${userId}@test.com`, 'x');
  sessionId = newId();
  getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
});

function addMessages(n: number): void {
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    getDb().prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(newId(), sessionId, role, `msg ${i}`);
  }
}

describe('shouldDistill', () => {
  it('returns false when session has fewer than 20 messages', () => {
    addMessages(10);
    expect(shouldDistill(sessionId)).toBe(false);
  });

  it('returns true when session hits exactly 20 messages', () => {
    addMessages(10); // total: 20
    expect(shouldDistill(sessionId)).toBe(true);
  });

  it('returns true at turn 30, 40, etc (every 10 thereafter)', () => {
    addMessages(10); // total: 30
    expect(shouldDistill(sessionId)).toBe(true);
  });

  it('returns false at turn 25 (not a trigger point)', () => {
    const sid2 = newId();
    getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sid2, userId);
    addMessages.call(null, 0); // use same session trick won't work, insert fresh
    for (let i = 0; i < 25; i++) {
      getDb().prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(newId(), sid2, i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`);
    }
    expect(shouldDistill(sid2)).toBe(false);
  });
});

describe('getTurnCount', () => {
  it('counts total messages in a session', () => {
    const count = getTurnCount(sessionId);
    expect(count).toBeGreaterThanOrEqual(30);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd server && npx vitest run tests/services/distill.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `server/src/services/distill.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { rememberFact } from './memory.js';

export function getTurnCount(sessionId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
    .get(sessionId) as { count: number };
  return row.count;
}

export function shouldDistill(sessionId: string): boolean {
  const count = getTurnCount(sessionId);
  if (count < 20) return false;
  return count === 20 || (count - 20) % 10 === 0;
}

const DISTILL_SYSTEM = `Summarize this conversation into a concise narrative (3–6 sentences) that captures: what the user is working on, key decisions made, and any important context a future session should know. Write in third person past tense. Be specific — include project names, tool choices, and outcomes where relevant.`;

export async function maybeDistill(userId: string, sessionId: string, apiKey: string): Promise<void> {
  if (!shouldDistill(sessionId)) return;

  const messages = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as Array<{ role: string; content: string }>;

  const transcript = messages
    .map(m => `${m.role}: ${m.content.slice(0, 800)}`)
    .join('\n\n');

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: DISTILL_SYSTEM,
      messages: [{ role: 'user', content: transcript }],
    });

    const summary = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    if (!summary) return;

    // Store on the session for context injection
    getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, sessionId);

    // Also persist as a memory entry so it survives session context limits
    const session = getDb()
      .prepare('SELECT pinned_project_id FROM sessions WHERE id = ?')
      .get(sessionId) as { pinned_project_id: string | null } | undefined;

    const projectId = session?.pinned_project_id ?? null;
    const memType = projectId ? 'project' : 'user';
    const memKey = `session_summary_${sessionId.slice(0, 8)}`;
    rememberFact(userId, memType, memKey, summary, projectId);
  } catch {
    // distillation is best-effort, never throw
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd server && npx vitest run tests/services/distill.test.ts
```

Expected: all passing.

- [ ] **Step 5: Wire into agent.ts — add import and fire-and-forget call**

Add import at the top of `server/src/services/agent.ts`:

```ts
import { maybeDistill } from './distill.js';
```

Immediately after the `extractAndRemember` fire-and-forget line, add:

```ts
maybeDistill(userId, sessionId, apiKey).catch(() => {});
```

- [ ] **Step 6: Update message history to use the sliding window**

Find the block that builds `currentMessages` from history. Currently it includes all messages. Update it to respect the session summary when present.

Note: `session` already has a `summary` field from the updated query in Task 6 step 3 — no second DB read needed.

Find:
```ts
const messages: Anthropic.MessageParam[] = history.map(m => ({
  role: m.role as 'user' | 'assistant',
  content: m.content,
}));

const currentMessages = [...messages];
```

Replace with:

```ts
// When a session summary exists, use a sliding window of the last 20 messages
// to keep context bounded; prepend the summary as a synthetic exchange.
const windowedHistory = session?.summary
  ? history.slice(-20)
  : history;

const messages: Anthropic.MessageParam[] = windowedHistory.map(m => ({
  role: m.role as 'user' | 'assistant',
  content: m.content,
}));

// Prepend the session summary as a synthetic priming exchange so the model
// knows what happened earlier in the conversation.
if (session?.summary && messages.length > 0) {
  messages.unshift(
    { role: 'assistant', content: `Session context noted.` },
    { role: 'user', content: `Earlier in this session: ${session.summary}` },
  );
}

const currentMessages = [...messages];
```

- [ ] **Step 7: Run the full test suite**

```bash
cd server && npx vitest run
```

Expected: all tests passing.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/distill.ts server/tests/services/distill.test.ts server/src/services/agent.ts
git commit -m "feat: add session distillation with sliding message window"
```

---

## Task 9: Final integration smoke test

- [ ] **Step 1: Run the full test suite one final time**

```bash
cd server && npx vitest run
```

Expected: all tests passing, no new failures introduced.

- [ ] **Step 2: Check that the old `buildSystemPrompt` and `recallAll` import are gone from agent.ts**

```bash
grep -n "buildSystemPrompt\|recallAll" server/src/services/agent.ts
```

Expected: no output. If either appears, remove it.

- [ ] **Step 3: Verify the new exports are all used**

```bash
grep -rn "extractIntent\|buildContext\|getToolSubset\|resolveModelForTurn\|recallRelevant\|extractAndRemember\|maybeDistill" server/src/
```

Expected: every function appears in at least two files (definition + call site).

- [ ] **Step 4: Commit any cleanup**

```bash
git add -p  # stage only actual changes
git commit -m "chore: remove dead code after orchestrator redesign"
```
