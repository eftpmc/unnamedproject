# Long-Task Reliability Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five targeted reliability gaps in long-running task handling: eager session-ID persistence, configurable sub-agent turn cap, parallel scheduler, enriched campaign error output, and a `wait_for_execution` tool with structured `generate_video` result.

**Architecture:** All changes are surgical edits to existing files — no new modules. Gaps 1–3 are independent; gap 6 depends on gap 5's pattern (both touch `dispatchTool`). Tests extend the existing `server/tests/services/agent.test.ts` where possible; scheduler gets its own test file.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Anthropic SDK, Node.js child_process

---

## File Map

| File | Changes |
|------|---------|
| `server/src/tools/invoke_claude_code.ts` | Add `onSessionId` to `ToolContext`; fire callback eagerly in stream handler |
| `server/src/tools/invoke_codex.ts` | Same as above |
| `server/src/services/agent.ts` | Update 4 call sites (gap 1); `runSubAgent` max_turns param + dispatch wiring (gap 3); enrich `runCampaignAutoDispatch` return + `run_campaign`/`run_pipeline` result JSON (gap 5); `generate_video` → JSON + `wait_for_execution` case + `PARALLEL_SAFE_TOOLS` entry (gap 6) |
| `server/src/services/scheduler.ts` | Serial → parallel (gap 4) |
| `server/src/tools/definitions.ts` | `max_turns` on `delegate_to_agent` (gap 3); new `wait_for_execution` tool (gap 6) |
| `server/tests/services/agent.test.ts` | Tests for gaps 1, 3, 5, 6 |
| `server/tests/services/scheduler.test.ts` | New file: tests for gap 4 |

---

## Task 1: Gap 1 — Eager session-ID in `invoke_claude_code`

**Files:**
- Modify: `server/src/tools/invoke_claude_code.ts`

- [ ] **Step 1: Add `onSessionId` to `ToolContext` and fire it in the stream handler**

In `invoke_claude_code.ts`, update the `ToolContext` interface and the stdout stream handler:

```ts
interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string | null;
  resumeSessionId?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
  permissionProfile?: PermissionProfile;
  onSessionId?: (id: string) => void;  // ADD THIS
}
```

Inside `invokeClaudeCode`, immediately after the `let sessionId: string | null = null;` declaration, add:

```ts
let sessionIdFired = false;
```

In the stdout stream handler, locate the line `if (typeof event.session_id === 'string') sessionId = event.session_id;` (first occurrence, inside the `while` loop). Replace it with:

```ts
if (typeof event.session_id === 'string') {
  sessionId = event.session_id;
  if (!sessionIdFired && ctx.onSessionId) {
    sessionIdFired = true;
    ctx.onSessionId(event.session_id);
  }
}
```

The second `if (typeof event.session_id === 'string') sessionId = event.session_id;` inside the `event.type === 'result'` block can stay as-is — the flag prevents double-firing.

- [ ] **Step 2: Commit**

```bash
git add server/src/tools/invoke_claude_code.ts
git commit -m "feat: fire onSessionId callback eagerly in invoke_claude_code stream"
```

---

## Task 2: Gap 1 — Eager session-ID in `invoke_codex`

**Files:**
- Modify: `server/src/tools/invoke_codex.ts`

- [ ] **Step 1: Add `onSessionId` to `ToolContext` and fire it in the stream handler**

In `invoke_codex.ts`, update the `ToolContext` interface (same addition as Task 1):

```ts
interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string | null;
  resumeSessionId?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
  permissionProfile?: PermissionProfile;
  onSessionId?: (id: string) => void;  // ADD THIS
}
```

Inside `invokeCodex`, after `let sessionId: string | null = null;`, add:

```ts
let sessionIdFired = false;
```

Locate the line `if (event.type === 'thread.started') sessionId = (event.thread_id as string) ?? sessionId;` and replace it with:

```ts
if (event.type === 'thread.started') {
  const threadId = (event.thread_id as string) ?? sessionId;
  sessionId = threadId;
  if (!sessionIdFired && threadId && ctx.onSessionId) {
    sessionIdFired = true;
    ctx.onSessionId(threadId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/tools/invoke_codex.ts
git commit -m "feat: fire onSessionId callback eagerly in invoke_codex stream"
```

---

## Task 3: Gap 1 — Update callers in `agent.ts`

**Files:**
- Modify: `server/src/services/agent.ts`
- Test: `server/tests/services/agent.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('agent', ...)` block in `server/tests/services/agent.test.ts`:

```ts
it('calls onSessionId eagerly when invokeClaudeCode resolves, before task completes', async () => {
  const db = getDb();
  const projectId = newId();
  db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
    .run(projectId, userId, 'eager-session', 'Eager session test', '/tmp/repo', '[]');

  const sessionIdFromCallback: string[] = [];
  invokeClaudeCodeMock.mockImplementationOnce(
    async (_input: unknown, ctx: { onSessionId?: (id: string) => void }) => {
      if (ctx.onSessionId) ctx.onSessionId('eager-session-abc');
      return { result: 'done', sessionId: 'eager-session-abc', costUsd: 0 };
    }
  );

  const { setAgentWorktreeSession: setWorktreeSpy } = await import('../../src/db/index.js');
  // Track calls via the worktree mock — ensureWorktreeMock returns id 'worktree-1'
  // After invokeClaudeCode resolves, the DB should have the session stored.

  streamMock.mockImplementationOnce(() => ({
    on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
    finalMessage: async () => ({
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: 'tool-cc', name: 'invoke_claude_code', input: { project_id: projectId, prompt: 'fix bug' } }],
    }),
  }));
  streamMock.mockImplementationOnce(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
      finalMessage: async () => {
        for (const cb of listeners.text ?? []) cb('done');
        return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
      },
    };
  });

  const msgId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'fix the bug');
  await runAgentTurn(userId, sessionId, msgId);

  // The worktree row should have claude_session_id = 'eager-session-abc' set by the callback
  const worktree = db.prepare('SELECT claude_session_id FROM agent_worktrees WHERE id = ?').get('worktree-1') as { claude_session_id: string | null } | undefined;
  expect(worktree?.claude_session_id).toBe('eager-session-abc');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && npx vitest run tests/services/agent.test.ts 2>&1 | tail -20
```

Expected: FAIL — `claude_session_id` is null because the current code only calls `setAgentWorktreeSession` post-success via `ccResult.sessionId`.

- [ ] **Step 3: Update the 4 call sites in `agent.ts`**

**3a. `executeCampaignTask` — `claude_code` case** (around line 318):

Replace:
```ts
const r = await invokeClaudeCode(
  { prompt: fullPrompt },
  { userId, executionId, repoPath: worktree.worktree_path, apiKey, resumeSessionId: worktree.claude_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId) },
);
if (r.sessionId) setAgentWorktreeSession(worktree.id, 'claude', r.sessionId);
```

With:
```ts
const r = await invokeClaudeCode(
  { prompt: fullPrompt },
  { userId, executionId, repoPath: worktree.worktree_path, apiKey, resumeSessionId: worktree.claude_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(worktree.id, 'claude', id) },
);
```

**3b. `executeCampaignTask` — `codex` case** (around line 347):

Replace:
```ts
const cr = await invokeCodex(
  { prompt: fullPrompt },
  { userId, executionId, repoPath: cWorktree.worktree_path, apiKey: codexApiKey, resumeSessionId: cWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId) },
);
if (cr.sessionId) setAgentWorktreeSession(cWorktree.id, 'codex', cr.sessionId);
```

With:
```ts
const cr = await invokeCodex(
  { prompt: fullPrompt },
  { userId, executionId, repoPath: cWorktree.worktree_path, apiKey: codexApiKey, resumeSessionId: cWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(cWorktree.id, 'codex', id) },
);
```

**3c. `dispatchTool` — `invoke_claude_code` case** (around line 567):

Replace:
```ts
const ccResult = await invokeClaudeCode(
  { prompt: ccPrompt, model: toolInput.model as string | undefined },
  { userId, executionId, repoPath: ccWorktree.worktree_path, apiKey: ccApiKey, resumeSessionId: ccWorktree.claude_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId) }
);
if (ccResult.sessionId) setAgentWorktreeSession(ccWorktree.id, 'claude', ccResult.sessionId);
```

With:
```ts
const ccResult = await invokeClaudeCode(
  { prompt: ccPrompt, model: toolInput.model as string | undefined },
  { userId, executionId, repoPath: ccWorktree.worktree_path, apiKey: ccApiKey, resumeSessionId: ccWorktree.claude_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(ccWorktree.id, 'claude', id) }
);
```

**3d. `dispatchTool` — `invoke_codex` case** (around line 606):

Replace:
```ts
const codexResult = await invokeCodex(
  { prompt: codexPrompt, model: toolInput.model as string | undefined },
  { userId, executionId, repoPath: codexWorktree.worktree_path, apiKey: codexApiKey, resumeSessionId: codexWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId) }
);
if (codexResult.sessionId) setAgentWorktreeSession(codexWorktree.id, 'codex', codexResult.sessionId);
```

With:
```ts
const codexResult = await invokeCodex(
  { prompt: codexPrompt, model: toolInput.model as string | undefined },
  { userId, executionId, repoPath: codexWorktree.worktree_path, apiKey: codexApiKey, resumeSessionId: codexWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(codexWorktree.id, 'codex', id) }
);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd server && npx vitest run tests/services/agent.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent.ts server/tests/services/agent.test.ts
git commit -m "feat: persist delegate session ID eagerly via onSessionId callback"
```

---

## Task 4: Gap 3 — Configurable sub-agent turn cap

**Files:**
- Modify: `server/src/services/agent.ts`
- Modify: `server/src/tools/definitions.ts`
- Test: `server/tests/services/agent.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('agent', ...)` block:

```ts
it('respects max_turns on delegate_to_agent and stops after N turns', async () => {
  const db = getDb();

  // Mock Anthropic to always return tool_use so the sub-agent never ends naturally
  const subAgentMock = vi.fn()
    .mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'sub-tool-1', name: 'recall', input: { type: 'user' } }],
      usage: { input_tokens: 5, output_tokens: 5 },
    });

  // We need to intercept the sub-agent's Anthropic calls separately from the
  // lead agent's stream. The sub-agent uses client.messages.create (not stream).
  // Patch it via the existing Anthropic mock.
  const anthropicMod = await import('@anthropic-ai/sdk');
  const ClientCls = vi.mocked(anthropicMod.default);
  const originalImpl = ClientCls.getMockImplementation();
  ClientCls.mockImplementationOnce(() => ({
    messages: {
      stream: streamMock, // lead agent still uses stream
      create: subAgentMock, // sub-agent uses create
    },
  }));

  // Lead agent emits delegate_to_agent with max_turns: 2
  streamMock.mockImplementationOnce(() => ({
    on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
    finalMessage: async () => ({
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: 'tool-da', name: 'delegate_to_agent', input: { instructions: 'do something', max_turns: 2 } }],
    }),
  }));
  streamMock.mockImplementationOnce(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
      finalMessage: async () => {
        for (const cb of listeners.text ?? []) cb('done');
        return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
      },
    };
  });

  const msgId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'delegate something');
  await runAgentTurn(userId, sessionId, msgId);

  // Sub-agent should have been called exactly 2 times (max_turns: 2)
  expect(subAgentMock).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && npx vitest run tests/services/agent.test.ts -t "respects max_turns" 2>&1 | tail -20
```

Expected: FAIL — sub-agent is called 15 times (hardcoded MAX_TURNS), not 2.

- [ ] **Step 3: Update `runSubAgent` to accept `maxTurns`**

In `agent.ts`, change the `runSubAgent` signature (around line 203):

```ts
async function runSubAgent(
  instructions: string,
  projectId: string | null,
  userId: string,
  parentExecutionId: string,
  parentMessageId: string,
  parentSessionId: string,
  campaignId?: string | null,
  maxTurns = 15,
): Promise<string> {
```

Change `const MAX_TURNS = 15;` to remove it, and update the loop condition from:

```ts
for (let turn = 0; turn < MAX_TURNS; turn++) {
```

to:

```ts
const clampedMaxTurns = Math.max(1, Math.min(50, maxTurns));
for (let turn = 0; turn < clampedMaxTurns; turn++) {
```

Update the "reached max turns" message at the end of `runSubAgent`:

```ts
return `Sub-agent reached max turns limit (${clampedMaxTurns}) without producing a final response.`;
```

- [ ] **Step 4: Wire `max_turns` through `dispatchTool`**

In the `delegate_to_agent` case of `dispatchTool` (around line 1087):

```ts
case 'delegate_to_agent': {
  const daInstructions = toolInput.instructions as string;
  const daProjectId = toolInput.project_id as string | undefined ?? null;
  const daTaskId = toolInput.campaign_task_id as string | undefined;
  const daCampaignId = daTaskId ? getCampaignForTask(daTaskId)?.id ?? null : null;
  const daMaxTurns = typeof toolInput.max_turns === 'number' ? toolInput.max_turns : 15;
  result = await runSubAgent(daInstructions, daProjectId, userId, executionId, messageId, sessionId, daCampaignId, daMaxTurns);
  break;
}
```

- [ ] **Step 5: Add `max_turns` to the `delegate_to_agent` tool definition**

In `server/src/tools/definitions.ts`, find the `delegate_to_agent` definition (line 407) and add to `properties`:

```ts
{
  name: 'delegate_to_agent',
  description: 'Spawn a focused sub-agent with its own context window to complete a specific task. The sub-agent can read files, search code, write files, and create artifacts, but cannot spawn further agents or create campaigns. Returns when the sub-agent finishes. Use for self-contained tasks that benefit from a fresh context (e.g. "analyze all API endpoints and write a summary doc").',
  input_schema: {
    type: 'object',
    properties: {
      instructions: { type: 'string', description: 'Clear instructions for what the sub-agent should do and return' },
      project_id: { type: 'string', description: 'Optional project context for the sub-agent' },
      max_turns: { type: 'integer', description: 'Maximum turns the sub-agent may take (1–50, default 15). Raise for complex multi-step tasks.', minimum: 1, maximum: 50 },
    },
    required: ['instructions'],
  },
},
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd server && npx vitest run tests/services/agent.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/agent.ts server/src/tools/definitions.ts server/tests/services/agent.test.ts
git commit -m "feat: make sub-agent turn cap configurable via max_turns (default 15, max 50)"
```

---

## Task 5: Gap 4 — Parallel scheduled tasks

**Files:**
- Modify: `server/src/services/scheduler.ts`
- Create: `server/tests/services/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/tests/services/scheduler.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { runDueScheduledTasks } from '../../src/services/scheduler.js';
import { newId } from '../../src/lib/ids.js';

// runScheduledTask ultimately calls runAgentTurn which needs Anthropic + socket mocked
vi.mock('../../src/services/scheduled_tasks.js', () => ({
  runScheduledTask: vi.fn(),
}));

import { runScheduledTask } from '../../src/services/scheduled_tasks.js';
const runScheduledTaskMock = vi.mocked(runScheduledTask);

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
});

describe('scheduler', () => {
  it('runs due tasks in parallel, not serially', async () => {
    const db = getDb();
    const userId = newId();
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `sched-${userId}@test.com`, 'x');

    // Insert 2 tasks both due now
    const now = Math.floor(Date.now() / 1000);
    const task1Id = newId();
    const task2Id = newId();
    db.prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, enabled, next_run_at) VALUES (?,?,?,?,?,?)')
      .run(task1Id, userId, 'reorganize_memory', 24, 1, now - 10);
    db.prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, enabled, next_run_at) VALUES (?,?,?,?,?,?)')
      .run(task2Id, userId, 'reorganize_memory', 24, 1, now - 10);

    const events: string[] = [];
    runScheduledTaskMock
      .mockImplementationOnce(async () => {
        events.push('task1:start');
        await new Promise(resolve => setTimeout(resolve, 30));
        events.push('task1:end');
      })
      .mockImplementationOnce(async () => {
        events.push('task2:start');
        events.push('task2:end');
      });

    await runDueScheduledTasks();

    // If parallel: task2 starts before task1 ends
    expect(events).toEqual(['task1:start', 'task2:start', 'task2:end', 'task1:end']);
    // If serial: ['task1:start', 'task1:end', 'task2:start', 'task2:end']
  });

  it('continues running remaining tasks when one fails', async () => {
    const db = getDb();
    const userId = newId();
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `sched2-${userId}@test.com`, 'x');

    const now = Math.floor(Date.now() / 1000);
    const task1Id = newId();
    const task2Id = newId();
    db.prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, enabled, next_run_at) VALUES (?,?,?,?,?,?)')
      .run(task1Id, userId, 'reorganize_memory', 24, 1, now - 10);
    db.prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, enabled, next_run_at) VALUES (?,?,?,?,?,?)')
      .run(task2Id, userId, 'reorganize_memory', 24, 1, now - 10);

    runScheduledTaskMock
      .mockRejectedValueOnce(new Error('task1 failed'))
      .mockResolvedValueOnce(undefined);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runDueScheduledTasks();

    expect(runScheduledTaskMock).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[scheduler]'), expect.anything(), expect.anything());
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && npx vitest run tests/services/scheduler.test.ts 2>&1 | tail -20
```

Expected: first test FAILS — events order is serial `['task1:start', 'task1:end', 'task2:start', 'task2:end']`.

- [ ] **Step 3: Replace serial loop with `Promise.allSettled`**

In `server/src/services/scheduler.ts`, replace:

```ts
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
```

With:

```ts
export async function runDueScheduledTasks(): Promise<void> {
  const due = getDueScheduledTasks(Math.floor(Date.now() / 1000));
  await Promise.allSettled(
    due.map(task =>
      runScheduledTask(task.user_id, task.id).catch(err =>
        console.error(`[scheduler] task ${task.id} (${task.type}) failed:`, err)
      )
    )
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npx vitest run tests/services/scheduler.test.ts 2>&1 | tail -20
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/scheduler.ts server/tests/services/scheduler.test.ts
git commit -m "feat: run due scheduled tasks in parallel via Promise.allSettled"
```

---

## Task 6: Gap 5 — Enrich `run_campaign` result with failure details

**Files:**
- Modify: `server/src/services/agent.ts`
- Test: `server/tests/services/agent.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/tests/services/agent.test.ts`:

```ts
it('includes errors array in run_campaign tool result when tasks fail', async () => {
  const db = getDb();
  const projectId = newId();
  db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
    .run(projectId, userId, 'campaign-errors', 'Campaign errors test', null, '[]');

  // Create a campaign with one error task
  const campaignId = newId();
  const taskId = newId();
  const execId = newId();
  db.prepare('INSERT INTO campaigns (id, project_id, session_id, title, status) VALUES (?,?,?,?,?)')
    .run(campaignId, projectId, sessionId, 'Test Campaign', 'error');
  db.prepare('INSERT INTO executions (id, message_id, project_id, tool, status, result) VALUES (?,?,?,?,?,?)')
    .run(execId, null, projectId, 'subagent', 'error', 'Exit 1: jest not found — full error message here');
  db.prepare('INSERT INTO campaign_tasks (id, campaign_id, title, agent, position, status, execution_id) VALUES (?,?,?,?,?,?,?)')
    .run(taskId, campaignId, 'Run tests', 'subagent', 0, 'error', execId);

  // Lead agent calls run_campaign
  streamMock.mockImplementationOnce(() => ({
    on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
    finalMessage: async () => ({
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: 'tool-rc', name: 'run_campaign', input: { campaign_id: campaignId } }],
    }),
  }));
  streamMock.mockImplementationOnce(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
      finalMessage: async () => {
        for (const cb of listeners.text ?? []) cb('noted');
        return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'noted' }] };
      },
    };
  });

  const msgId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'run the campaign');
  await runAgentTurn(userId, sessionId, msgId);

  // Inspect what the lead agent received as the tool result
  const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
  const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
    m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
  );
  const toolResult = JSON.parse((toolResultMsg.content as { content: string }[])[0].content);

  expect(toolResult.errors).toBeDefined();
  expect(toolResult.errors).toHaveLength(1);
  expect(toolResult.errors[0]).toMatchObject({
    task_id: taskId,
    title: 'Run tests',
    error: expect.stringContaining('jest not found'),
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && npx vitest run tests/services/agent.test.ts -t "includes errors array" 2>&1 | tail -20
```

Expected: FAIL — `toolResult.errors` is `undefined`.

- [ ] **Step 3: Enrich `runCampaignAutoDispatch` return value**

In `agent.ts`, find the end of `runCampaignAutoDispatch` (around line 480):

Replace:
```ts
const finalTasks = getCampaignTasks(campaignId);
return {
  done: finalTasks.filter(t => t.status === 'done').length,
  error: finalTasks.filter(t => t.status === 'error').length,
  total: finalTasks.length,
};
```

With:
```ts
const finalTasks = getCampaignTasks(campaignId);
const erroredTasks = finalTasks.filter(t => t.status === 'error');
const errors = erroredTasks.map(t => {
  const ex = t.execution_id ? getExecutionById(t.execution_id) : null;
  const errorMsg = ex?.result ?? 'Unknown error';
  return {
    task_id: t.id,
    title: t.title,
    error: errorMsg.length > 500 ? errorMsg.slice(0, 500) + '…' : errorMsg,
  };
});
return {
  done: finalTasks.filter(t => t.status === 'done').length,
  error: finalTasks.filter(t => t.status === 'error').length,
  total: finalTasks.length,
  errors,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npx vitest run tests/services/agent.test.ts 2>&1 | tail -20
```

Expected: all tests PASS. The `errors` array is automatically spread into the `run_campaign` and `run_pipeline` result JSON via the existing `{ campaign_id, status, ...summary }` spread — no changes needed to those dispatch cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent.ts server/tests/services/agent.test.ts
git commit -m "feat: include failed task details in run_campaign tool result"
```

---

## Task 7: Gap 6 — `wait_for_execution` tool + structured `generate_video` result

**Files:**
- Modify: `server/src/services/agent.ts`
- Modify: `server/src/tools/definitions.ts`
- Test: `server/tests/services/agent.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/services/agent.test.ts`:

```ts
it('generate_video returns JSON with execution_id', async () => {
  const db = getDb();
  const projectId = newId();
  db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
    .run(projectId, userId, 'video-json', 'Video JSON test', null, '[]');

  // Mock renderVideo via the video module
  vi.mock('../../src/services/video.js', () => ({
    renderVideo: vi.fn().mockResolvedValue('test-video.mp4'),
  }));

  streamMock.mockImplementationOnce(() => ({
    on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
    finalMessage: async () => ({
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: 'tool-vid', name: 'generate_video', input: { project_id: projectId, title: 'Test', scenes: [{ text: 'hello', durationInSeconds: 2 }] } }],
    }),
  }));
  streamMock.mockImplementationOnce(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
      finalMessage: async () => {
        for (const cb of listeners.text ?? []) cb('video started');
        return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'video started' }] };
      },
    };
  });

  const msgId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'render a video');
  await runAgentTurn(userId, sessionId, msgId);

  const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
  const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
    m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
  );
  const toolResult = JSON.parse((toolResultMsg.content as { content: string }[])[0].content);
  expect(toolResult.execution_id).toBeDefined();
  expect(toolResult.status).toBe('started');
  expect(toolResult.message).toContain('wait_for_execution');
});

it('wait_for_execution returns result when execution reaches done state', async () => {
  const db = getDb();
  const execId = newId();
  // Insert an execution that is already 'done'
  db.prepare('INSERT INTO executions (id, message_id, project_id, tool, status, result) VALUES (?,?,?,?,?,?)')
    .run(execId, null, null, 'generate_video', 'done', 'Rendered test-video.mp4');

  streamMock.mockImplementationOnce(() => ({
    on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
    finalMessage: async () => ({
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: 'tool-wfe', name: 'wait_for_execution', input: { execution_id: execId } }],
    }),
  }));
  streamMock.mockImplementationOnce(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
      finalMessage: async () => {
        for (const cb of listeners.text ?? []) cb('done');
        return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
      },
    };
  });

  const msgId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'wait for the video');
  await runAgentTurn(userId, sessionId, msgId);

  const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
  const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
    m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
  );
  const toolResult = JSON.parse((toolResultMsg.content as { content: string }[])[0].content);
  expect(toolResult.status).toBe('done');
  expect(toolResult.result).toBe('Rendered test-video.mp4');
});

it('wait_for_execution returns error string on timeout', async () => {
  const db = getDb();
  const execId = newId();
  // Insert an execution stuck in 'running'
  db.prepare('INSERT INTO executions (id, message_id, project_id, tool, status) VALUES (?,?,?,?,?)')
    .run(execId, null, null, 'generate_video', 'running');

  streamMock.mockImplementationOnce(() => ({
    on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
    finalMessage: async () => ({
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      // Very short timeout to keep test fast
      content: [{ type: 'tool_use', id: 'tool-wfe2', name: 'wait_for_execution', input: { execution_id: execId, timeout_seconds: 1 } }],
    }),
  }));
  streamMock.mockImplementationOnce(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
      finalMessage: async () => {
        for (const cb of listeners.text ?? []) cb('noted');
        return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'noted' }] };
      },
    };
  });

  const msgId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'wait for video with timeout');
  await runAgentTurn(userId, sessionId, msgId);

  const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
  const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
    m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
  );
  const toolResult = (toolResultMsg.content as { content: string }[])[0].content;
  expect(toolResult).toContain('Error');
  expect(toolResult).toContain('still running');
}, 10_000);
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd server && npx vitest run tests/services/agent.test.ts -t "generate_video|wait_for_execution" 2>&1 | tail -20
```

Expected: all three FAIL — `generate_video` returns a plain string, `wait_for_execution` is an unknown tool.

- [ ] **Step 3: Update `generate_video` in `dispatchTool` to return structured JSON**

In `agent.ts`, find the `generate_video` case (around line 1096). Replace the early return:

```ts
// Return early — completeExecution is handled by the fire-and-forget above
return `Video render started (execution ${executionId}). It will appear in the project's Artifacts tab when done.`;
```

With:

```ts
// Return early — completeExecution is handled by the fire-and-forget above
return JSON.stringify({
  execution_id: executionId,
  status: 'started',
  message: 'Video render started. Call wait_for_execution with this execution_id to await completion, then check project Artifacts.',
});
```

- [ ] **Step 4: Add `wait_for_execution` to `PARALLEL_SAFE_TOOLS`**

In `agent.ts`, find the `PARALLEL_SAFE_TOOLS` set (around line 149) and add:

```ts
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
  'list_campaigns',
  'get_campaign',
  'get_execution_output',
  'list_scheduled_tasks',
  'wait_for_execution',  // ADD THIS
]);
```

- [ ] **Step 5: Add `wait_for_execution` case to `dispatchTool`**

In `agent.ts`, in `dispatchTool`, add before the `default:` case:

```ts
case 'wait_for_execution': {
  const waitExecId = toolInput.execution_id as string;
  const timeoutSecs = Math.min(600, (toolInput.timeout_seconds as number | undefined) ?? 300);
  const deadline = Date.now() + timeoutSecs * 1000;

  let waitResult: string | null = null;
  while (Date.now() < deadline) {
    const ex = getExecutionById(waitExecId);
    if (!ex) { waitResult = `Error: execution ${waitExecId} not found`; break; }
    if (ex.status === 'done' || ex.status === 'error') {
      const LOG_CAP = 8000;
      const log = ex.output_log;
      const output_log = log.length > LOG_CAP ? `[truncated — showing last ${LOG_CAP} of ${log.length} chars]\n${log.slice(-LOG_CAP)}` : log;
      waitResult = JSON.stringify({ id: ex.id, tool: ex.tool, status: ex.status, result: ex.result, output_log });
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  result = waitResult ?? `Error: execution ${waitExecId} still running after ${timeoutSecs}s timeout`;
  break;
}
```

Note: `wait_for_execution` is a read-only polling operation. The `createExecution` call at the top of `dispatchTool` creates a tracking execution for it, which will be completed at the bottom via `completeExecution`. This is consistent with all other tools.

- [ ] **Step 6: Add `wait_for_execution` to tool definitions**

In `server/src/tools/definitions.ts`, add after the `get_execution_output` definition:

```ts
{
  name: 'wait_for_execution',
  description: 'Block until an execution reaches a terminal state (done or error), then return its result and output log. Use after generate_video (or any fire-and-forget tool) when downstream work depends on its completion. Times out after timeout_seconds (default 300, max 600) and returns an error string if still running.',
  input_schema: {
    type: 'object',
    properties: {
      execution_id: { type: 'string', description: 'ID of the execution to wait for' },
      timeout_seconds: { type: 'integer', description: 'Max seconds to wait before returning a timeout error (default 300, max 600)', minimum: 1, maximum: 600 },
    },
    required: ['execution_id'],
  },
},
```

- [ ] **Step 7: Run all tests to verify they pass**

```bash
cd server && npx vitest run tests/services/agent.test.ts tests/services/scheduler.test.ts 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/agent.ts server/src/tools/definitions.ts server/tests/services/agent.test.ts
git commit -m "feat: structured generate_video result and wait_for_execution tool"
```

---

## Final Verification

- [ ] **Run the full server test suite**

```bash
cd server && npx vitest run 2>&1 | tail -20
```

Expected: all tests PASS with no regressions.

- [ ] **Final commit if any cleanup needed**

```bash
git add -p
git commit -m "chore: cleanup after long-task reliability implementation"
```
