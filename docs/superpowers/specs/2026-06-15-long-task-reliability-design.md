# Long-Task Reliability Improvements

**Date:** 2026-06-15

## Overview

Five targeted reliability fixes for long-running task handling. No new abstractions — each fix is surgical and scoped to the specific gap.

---

## Gap 1 — Session ID persisted on delegate agent timeout

**Problem:** `invokeClaudeCode` / `invokeCodex` only store the Claude Code `session_id` to the worktree after the process exits successfully. If a run times out (30-min hard limit) and rejects, the session ID is lost and retries start a fresh session instead of resuming.

**Fix:** Add `onSessionId?: (id: string) => void` to `ToolContext` in both invocation files. The first time a `session_id` appears in the stdout stream, call the callback (once, guarded by a flag). Callers pass `onSessionId: (id) => setAgentWorktreeSession(worktree.id, 'claude'/'codex', id)`. Remove the existing post-success `setAgentWorktreeSession` call — the eager callback replaces it.

**Affected files:**
- `server/src/tools/invoke_claude_code.ts`
- `server/src/tools/invoke_codex.ts`
- `server/src/services/agent.ts` — `executeCampaignTask` and the `invoke_claude_code` / `invoke_codex` cases in `dispatchTool`

---

## Gap 3 — Sub-agent turn cap configurable

**Problem:** `runSubAgent` hardcodes `MAX_TURNS = 15` with no override. Complex delegated tasks hit the cap before completing.

**Fix:**
- `runSubAgent` gains a `maxTurns = 15` parameter (accepted range 1–50, clamped).
- `delegate_to_agent` tool definition gets an optional `max_turns` integer field (1–50, default 15).
- `dispatchTool` reads `toolInput.max_turns` and passes it through.

**Affected files:**
- `server/src/services/agent.ts` — `runSubAgent` signature and `delegate_to_agent` dispatch case
- `server/src/tools/definitions.ts` — `delegate_to_agent` schema

---

## Gap 4 — Scheduler runs due tasks in parallel

**Problem:** `runDueScheduledTasks` runs tasks serially with `for...of`. A slow task (e.g. a long `custom_prompt` run) blocks all other due tasks.

**Fix:** Replace the serial loop with `Promise.allSettled`. Error isolation is unchanged — each task's rejection is caught and logged independently.

**Affected files:**
- `server/src/services/scheduler.ts`

---

## Gap 5 — `run_campaign` result includes failure details

**Problem:** `run_campaign` returns only `{status, done, error, total}`. The lead agent must make an extra `get_campaign` call to find out which tasks failed and why.

**Fix:** After the dispatch loop, collect errored tasks and their execution results. Append an `errors` array to the returned JSON:

```json
{
  "campaign_id": "...",
  "status": "error",
  "done": 2,
  "error": 1,
  "total": 3,
  "errors": [
    { "task_id": "...", "title": "Run tests", "error": "Exit 1: jest not found" }
  ]
}
```

Error messages truncated to 500 chars. The lead agent has everything it needs in the `run_campaign` tool result to decide whether to `resume_campaign`, modify tasks, or escalate to the user.

**Affected files:**
- `server/src/services/agent.ts` — `runCampaignAutoDispatch` return value and the `run_campaign` / `run_pipeline` dispatch cases in `dispatchTool`

---

## Gap 6 — `wait_for_execution` tool + structured `generate_video` result

**Problem:** `generate_video` is fire-and-forget — the lead agent gets back a plain string with no execution ID it can track, and has no way to await completion before running dependent tasks.

**Fix (two parts):**

**Part A — `generate_video` returns structured JSON:**
```json
{ "execution_id": "...", "status": "started", "message": "Video render started. Call wait_for_execution to await completion." }
```

**Part B — New `wait_for_execution` tool:**
- Input: `execution_id` (string), optional `timeout_seconds` (integer, default 300, max 600)
- Polls `getExecutionById` every 2 seconds until status is `done` or `error`
- On terminal state: returns the same payload as `get_execution_output` (status, result, truncated log)
- On timeout: returns an error string indicating the execution is still running

The lead agent's pattern:
1. Call `generate_video` → extract `execution_id`
2. (Optionally do other work)
3. Call `wait_for_execution` to block until render completes
4. Proceed with artifact-dependent tasks

`wait_for_execution` is general-purpose and works for any execution, not just video renders.

**Affected files:**
- `server/src/services/agent.ts` — `generate_video` result string → JSON; new `wait_for_execution` case in `dispatchTool`
- `server/src/tools/definitions.ts` — add `wait_for_execution` tool schema

---

## What this does NOT change

- Campaign retry logic: the lead agent handles retries via `resume_campaign` + `run_campaign`. No automatic retry layer added.
- `on_error` behavior: `run_campaign` still stops or continues on first error per the existing parameter.
- Delegate timeout: still 30 minutes. Session resumption makes timeouts recoverable, not avoidable.
- Sub-agent tool set or model: unchanged.
