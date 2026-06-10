# Core Agent Platform — Design Spec
**Date:** 2026-06-09
**Scope:** Sub-projects 1 + 2 — Core server + agent runtime
**Status:** Draft

---

## Overview

A self-hostable, paid AI operator platform. Users speak or type to a single lead agent that understands their intent, selects the right workspace, breaks work into sub-tasks, and executes them using tools — Claude Code, Codex, GitHub, MCP servers, and git operations. Heavy work streams back in real time. Destructive actions require user approval before executing.

Separate from pilotapp. Fresh codebase, same proven stack.

---

## Product Shape

- **Server:** self-hosted Node.js API — the source of truth
- **Web UI:** minimal React client — thread + sidebar + settings, nothing more
- **iOS/macOS app:** native SwiftUI client with voice input
- **SaaS tier:** hosted cloud version (subscription); self-hosting available as separate tier

---

## Stack

| Layer | Tech |
|---|---|
| Server | Node.js + TypeScript + Express + SQLite (better-sqlite3) + WebSocket (ws) |
| Web | React 19 + Vite + Tailwind v4 + TanStack Query |
| iOS/macOS | Swift + SwiftUI |

Monorepo structure:
```
/server    API + agent runtime + tool executors
/web       React web client
/app       SwiftUI iOS + macOS client
```

---

## Data Model

### User
```
id, email, hashed_password, created_at
```
One lead agent config per user.

### Connection
```
id, user_id, name, type (anthropic | openai | github | mcp), encrypted_config, created_at
```
Reusable credentials. Config is encrypted at rest. Types:
- `anthropic` — API key for lead agent + Claude Code
- `openai` — API key for Codex
- `github` — OAuth token or PAT
- `mcp` — MCP server config (transport, command, env)

### Workspace
```
id, user_id, name, description, repo_path, enabled_connection_ids (JSON array), created_at
```
Named execution context. Groups a repo with the connections needed to work in it. The lead agent routes work here based on context or by asking the user.

- `repo_path` — absolute path on the server filesystem. Server clones and manages the repo on behalf of the user; the agent never asks the user to clone manually.
- `enabled_connection_ids` — the connections available when working in this workspace. The lead agent picks the appropriate connection per tool call (e.g. uses the Anthropic connection for `invoke_claude_code`, GitHub connection for `github_api`).

### Thread
```
id, user_id, title, created_at, updated_at
```
A conversation with the lead agent. Multiple threads per user. Agent has full access to all workspaces regardless of which thread is active.

### Message
```
id, thread_id, role (user | assistant), content, created_at
```
Conversation history. Assistant messages may reference execution IDs.

### Execution
```
id, message_id, workspace_id, tool, status (pending | running | done | error | awaiting_approval),
output_log, result, created_at, completed_at
```
Background work dispatched by the lead agent. Streams output via WebSocket. Surfaces as an inline card in the thread.

### Approval
```
id, execution_id, action, payload (JSON), status (pending | approved | rejected), resolved_at
```
Gate for destructive actions. Execution halts at `awaiting_approval` until user approves or rejects.

---

## Memory Architecture

Two persistent layers — both query before each agent turn:

### 1. Workspace Graph (Graphify)
- Built once when a workspace is added; rebuilt on demand or when repo changes
- Converts the codebase into a queryable knowledge graph: functions, classes, imports, call graph, docstrings
- Lead agent queries this instead of reading raw files — dramatically reduces token usage on large repos
- Graphify runs as a subprocess (Python CLI); output stored in workspace directory. **Requires Python 3.10+ on the server** — document as a system dependency.
- Supports 33 languages via Tree-sitter (no API calls during indexing — code stays local)

### 2. User Memory
- Key-value facts the agent writes and reads across sessions
- Stores: preferences, past decisions, patterns, frequently used workspaces
- Simple for v1 — no embeddings or RAG. Agent writes facts via `remember` tool, reads via `recall` tool
- Stored in SQLite as `user_memory (id, user_id, key, value, created_at, updated_at)`

---

## Agent Runtime

### Lead Agent
- Built on Anthropic API with tool-use (claude-sonnet-4-6 or claude-opus-4-8)
- One persistent agent per user
- Receives on each turn: thread history + relevant user memory + workspace graph query results
- Decides to respond inline or dispatch one or more sub-agents
- Synthesizes sub-agent results and appends response to thread

### Sub-agents
- Spawned as background processes scoped to a workspace + tool
- Run in parallel when independent
- Stream stdout/stderr back to server via WebSocket
- On completion, result is passed back to lead agent for synthesis

### Tool Set

| Tool | Behavior | Approval required |
|---|---|---|
| `invoke_claude_code` | Spawns Claude Code CLI in workspace repo | No |
| `invoke_codex` | Spawns Codex CLI in workspace repo | No |
| `github_api` | Read: free. Write (issues, comments): approval | Write ops only |
| `mcp_call` | Calls configured MCP server tool | No |
| `git_op` | Read (log, diff, status): free. Write (commit, push): approval | Write ops only |
| `workspace_query` | Queries Graphify knowledge graph for a workspace | No |
| `remember` | Writes a fact to user memory | No |
| `recall` | Reads from user memory | No |

### Workspace Routing
When the user's intent doesn't clearly map to a workspace, the lead agent asks before dispatching. It uses user memory and thread context to infer the right workspace when possible.

---

## Approval Gate

When a tool call is tagged destructive:
1. Execution status set to `awaiting_approval`
2. Inline execution card in thread updates to show action + payload (e.g. `git commit -m "fix auth token expiry"`)
3. User sees **Approve** / **Reject** buttons
4. On approve: execution resumes from the paused point
5. On reject: agent is notified via tool result, responds in thread
6. No destructive action ever executes without explicit user approval

---

## Live Execution Display

Executions surface as **inline expandable cards** directly in the thread:

- Status badge: `running` (pulsing) / `done` / `error` / `awaiting approval`
- Tool name + workspace name
- Collapsible live output (streaming, monospace)
- Result summary when complete
- Approve/Reject buttons when awaiting approval

The thread is the primary surface. Executions are part of the conversation, not a separate panel.

---

## Voice Input (iOS)

- Native iOS speech recognition — no third-party API
- Tap-to-talk button in thread input bar
- Transcribes locally, submits as text to lead agent
- Private, no additional cost

---

## Web UI Structure

Three surfaces, nothing else:

1. **Thread view** — conversation with the lead agent, execution cards inline
2. **Sidebar** — workspace list, connection list, thread list, new thread action
3. **Settings** — connections, workspaces, user memory viewer, account

No dashboards, no kanban, no charts. The agent is the interface.

---

## API Shape

### REST (Express)
```
POST   /auth/register
POST   /auth/login
GET    /workspaces
POST   /workspaces
DELETE /workspaces/:id
GET    /connections
POST   /connections
DELETE /connections/:id
GET    /threads
POST   /threads
GET    /threads/:id/messages
POST   /threads/:id/messages       — triggers agent turn
GET    /executions/:id
POST   /executions/:id/approve
POST   /executions/:id/reject
```

### WebSocket
- Auth via JWT on connect
- Server pushes: `execution_update` (status + output chunk), `message_created`, `approval_requested`
- Client subscribes on connect; no per-resource subscription needed for v1

---

## Environment Variables

| Var | Default | Notes |
|---|---|---|
| `PORT` | 3000 | Server port |
| `DATA_DIR` | `./data` | SQLite db + workspace repos + logs |
| `JWT_SECRET` | — | Required; warns loudly if unset |
| `NODE_ENV` | — | `development` suppresses JWT warning |
| `ALLOW_REGISTRATION` | — | `true` to allow >1 user |

---

## Out of Scope (v1)

- SSH / remote shell execution
- Pull request creation or review
- Push notifications (APNs)
- Billing / subscription management
- Multi-user teams
- Embedding-based user memory (RAG)
- Multiple lead agents per user
