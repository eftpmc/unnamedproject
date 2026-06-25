# Conversation Provider: Replace Lead Agent with Claude Code / Codex

**Date:** 2026-06-25  
**Status:** Approved

## Goal

Replace the custom lead-agent agentic loop with Claude Code and Codex as first-class conversational providers. Users run chat on their own subscription (CLI mode) or API key — the app stops being an API-token billing intermediary for the main chat loop. All custom app tools are exposed via an MCP server the app runs locally.

Remove the plan system (Claude Code handles multi-step work natively) and remove Claude Code / Codex as special-cased tools — they become connections like any other.

---

## What Changes

| Before | After |
|---|---|
| `runAgentTurn` owns the agentic loop, calls Anthropic/OpenAI API directly | `runAgentTurn` spawns a `ConversationProvider` (Claude Code or Codex CLI) |
| Claude Code and Codex are sub-tools dispatched by the lead agent | Claude Code / Codex are the conversational agent; app tools come via MCP |
| ~40 tools defined in `tools/definitions.ts` + dispatched in `agent.ts` | ~20 tools exposed as MCP tools; file/bash/web fetch are native to the CLI |
| Plans system orchestrates multi-step work across step types | Removed — Claude Code handles multi-step work natively |
| `subagent` step type calls Anthropic API directly | Replaced by Claude Code invocation |
| Lead Agent configured via connection (anthropic/openai/local) | Removed — provider comes from a `claude_code` or `codex` connection |
| Claude Code and Codex have special settings sections | Become connections like MCP, with mode: `local` (CLI/subscription) or `api` (key-based) |

---

## Architecture

```
User message
    ↓
runAgentTurn (thin — ~30 lines)
    ↓
ConversationProvider.invoke()
    │
    ├── ClaudeCodeProvider  →  invokeClaudeCode(prompt, resumeSessionId, ...)
    └── CodexProvider       →  invokeCodex(prompt, resumeSessionId, ...)
         │
         ├── --resume <provider_session_id>     ← per chat session
         ├── --append-system-prompt <ctx>       ← space/intent context
         └── --mcp-config → app MCP server      ← all custom tools
              │
              ├── spaces, items, memory
              ├── git_op, project_query
              ├── connections, schedules
              └── (file I/O, bash, web fetch stay native to CLI)
         ↓
    stream-json → filter assistant text → broadcast message_delta
```

---

## ConversationProvider Interface

```typescript
interface ConversationProvider {
  readonly type: 'claude_code' | 'codex';

  invoke(params: {
    prompt: string;
    resumeSessionId?: string;
    systemPromptSuffix?: string;
    mcpServers: Record<string, McpServerConfig>;
    model?: string;
    signal?: AbortSignal;
    onText: (delta: string) => void;
    onSessionId: (id: string) => void;
  }): Promise<{ costUsd?: number }>;

  resolveModel(session: { model: string | null } | undefined, intent: { model: string }): Promise<string>;
}
```

**Implementations:** `ClaudeCodeProvider` wraps `invokeClaudeCode`; `CodexProvider` wraps `invokeCodex`. Both exist now. Future providers (Gemini CLI, API-direct) slot in without touching `runAgentTurn`.

---

## Connections Model

Claude Code and Codex become connection types stored in the `connections` table alongside `mcp`, `anthropic`, `openai`.

**`claude_code` connection config:**
```json
{
  "mode": "local",       // "local" = CLI/subscription | "api" = Anthropic API key
  "apiKey": "sk-...",    // required if mode = "api", unused if mode = "local"
  "model": "claude-sonnet-4-6",
  "permissionProfile": "default"
}
```

**`codex` connection config:**
```json
{
  "mode": "local",       // "local" = Codex CLI | "api" = OpenAI API key
  "apiKey": "sk-...",    // required if mode = "api"
  "model": "codex-mini-latest",
  "permissionProfile": "default"
}
```

Provider resolution: `getConversationProvider(userId)` reads the user's active `claude_code` or `codex` connection. Falls back to whichever CLI is detected on `$PATH` in local mode if no connection is configured.

---

## MCP Server

A new `server/src/mcp/` module mounts an MCP endpoint at `/mcp` on the existing Express server using Streamable HTTP transport.

**Auth:** `runAgentTurn` generates a short-lived bearer token (userId + expiry, signed with app secret). Passed in the `--mcp-config` headers. MCP endpoint validates token → resolves `userId` for all tool calls.

**Tools that move to MCP (~20):**

| Category | Tools |
|---|---|
| Spaces | `list_spaces`, `create_space`, `update_space`, `delete_space` |
| Items | `list_items`, `read_item`, `create_item`, `update_item`, `create_note` |
| Item templates | `list_item_templates`, `create_item_template`, `update_item_template` |
| Memory | `remember`, `recall`, `forget` |
| Git | `git_op` |
| Knowledge graph | `project_query`, `rebuild_graph` |
| Connections | `list_connections`, `create_connection`, `test_connection` |
| Schedules | `list_scheduled_tasks`, `create_scheduled_task`, `update_scheduled_task` |
| Chat history | `list_chats`, `read_chat` |

**Tools dropped (native to Claude Code):** `read_file`, `list_dir`, `search_files`, `write_file`, `run_command`

**Tools dropped (plan system removed):** `create_plan`, `run_plan`, `resume_plan`, `get_plan`, `list_plans`, `get_execution_output`, `wait_for_execution`, `create_pipeline`, `run_pipeline`, `delegate_to_agent`

**Tools dropped (no longer needed):** `invoke_claude_code`, `invoke_codex`, `tool_search`, `generate_video` (media pipeline TBD separately), `register_file_item`

---

## Session Management

`sessions` table gets two new columns replacing all previous session/provider ID columns:

- `provider_type TEXT` — `'claude_code'` | `'codex'`
- `provider_session_id TEXT` — the CLI session ID, captured on first turn and stored via `onSessionId`

`session.summary` and `session.effort` are deprecated — Claude Code manages its own context window; effort maps to model and is now set on the connection.

**Turn flow:**
1. Look up `session.provider_type` and `session.provider_session_id`
2. Generate MCP auth token for this turn
3. Call `provider.invoke({ prompt, resumeSessionId: session.provider_session_id, ... })`
4. On first turn, `onSessionId` fires → store provider session ID on the session row
5. Pipe `onText` deltas → `message_delta` WebSocket broadcasts

---

## Streaming

Claude Code's `--output-format stream-json` emits structured events. The app filters for:

```json
{ "type": "assistant", "message": { "content": [{ "type": "text", "text": "..." }] } }
```

Each text chunk broadcasts as `message_delta`. From the UI's perspective nothing changes — same WebSocket events as today.

MCP tool call events can optionally surface as `session_event` entries for sidebar activity (space linked, item created, etc.). Start with this off; add selectively.

---

## Plans: Removed

The entire plan system is removed:

- `plans` and `plan_steps` DB tables dropped
- `executePlanStep`, `runPlanAutoDispatch`, `buildPlanPriorContext` deleted
- `create_plan`, `run_plan`, `resume_plan` tools removed from MCP
- Plan UI in spaces removed

Claude Code handles multi-step work natively within its session. Users describe what they want; Claude Code sequences the work.

---

## Subagents: Fixed

`runSubAgent` (which hardcodes the Anthropic API) is deleted. Any remaining need for a focused sub-task is met by the conversation provider directly — Claude Code can spawn its own sub-agents natively. The `delegate_to_agent` tool is removed.

---

## Attachments

`buildMessageContent` currently serializes images/PDFs into the API call. With CLI providers, attachments are written to a temp file path and the path is appended to the prompt. Image attachments can use Claude Code's native image input if supported; otherwise inline as base64 in the prompt preamble.

---

## Post-Turn Hooks

`maybeGenerateSessionTitle` and `extract-memory` / `distill` currently call the Anthropic API directly. Options:

- **Keep with API key**: require a separate Anthropic connection for these background tasks (not chat — invisible to the user)
- **Drop**: title generation and memory extraction become optional features only available when an API key connection exists

Start with the second: these are best-effort. If an `anthropic` connection exists, fire them. If not, skip silently. No hard dependency.

---

## Settings UI

- Remove "Lead Agent" section entirely
- "Chat Agent" section: shows configured `claude_code` / `codex` connections
- Each connection: mode toggle (Local / API Key), model picker, permission profile
- Auto-detection: if no connection configured, detect installed CLIs and offer to set up

---

## What Gets Deleted

- `server/src/services/lead_agent_providers.ts`
- `server/src/services/agent.ts` → `runAgentTurn`, `dispatchTool`, `dispatchToolBlocks`, `runSubAgent`, `executePlanStep`, `runPlanAutoDispatch`, `buildPlanPriorContext` (file shrinks dramatically or is replaced)
- `server/src/tools/definitions.ts` → tools that moved to MCP or were dropped
- `server/src/tools/invoke_claude_code.ts` / `invoke_codex.ts` → move or merge into provider implementations
- Plan-related DB tables and migrations
- Plan UI components in `web/`

---

## Implementation Order

1. **MCP server** (`server/src/mcp/`) — foundation; nothing else works without it
2. **`ConversationProvider` interface** + `ClaudeCodeProvider` / `CodexProvider`
3. **Replace `runAgentTurn`** — wire provider, session ID storage, stream piping
4. **`claude_code` / `codex` connections** — settings UI, connection type handlers
5. **Remove plan system** — DB, server, UI
6. **Cleanup** — delete `lead_agent_providers.ts`, dead tools, deprecated columns
