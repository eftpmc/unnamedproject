# Current Architecture

Unnamed is a local agent workspace for chats, Spaces, Items, plans, pipelines, executions, memory, and scheduled work.

## Runtime Shape

- `server/`: Express API, WebSocket server, SQLite data model, agent/tool orchestration, executions, Spaces, Items, plans, pipelines, memory, scheduled tasks, and MCP process pooling.
- `web/`: React/Vite client with React Query, authenticated API calls, WebSocket updates, chat UI, contextual Space navigation, Item views, plans, pipelines, and settings.
- `remotion/`: shared Remotion renderer used by the `generate_video` tool.
- `data/`: local runtime storage for SQLite, Space files, media, attachments, worktrees, and generated Items.

## Space Surface

Spaces are containers for chats, Items, plans, and pipelines. The global sidebar becomes a contextual Space sidebar with these top-level destinations:

- Overview
- Chats
- Items
- Plans
- Pipelines
- Settings

Pipelines are a peer of Plans, not nested under them. Generated outputs are Items with provenance rather than a separate category.

## Chats And Turns

Chats are `sessions`. A user message creates a `session_turns` row with `status='running'`; the turn is marked `done` or `error` when the agent completes or fails.

The status endpoint is the recovery source for reloads and mobile foregrounding:

```txt
GET /sessions/:id/status
```

It returns whether the chat is active, the active turn if present, and the active execution if one is running or awaiting approval.

Messages are persisted in `messages`. User messages can include attachments stored in `message_attachments`. Attachments are saved under:

```txt
{DATA_DIR}/attachments/{userId}/{sessionId}/{messageId}/
```

Conversation truncation removes both message rows and stored attachment files:

```txt
DELETE /sessions/:id/messages/from/:messageId
```

## Realtime

The server hosts a WebSocket endpoint on the same HTTP server. Clients connect with a bearer token in the query string:

```txt
ws://host?token=<jwt>
```

The web client uses `VITE_API_PORT` in dev and falls back to port `3000`.

Important event types:

- `message_started`
- `message_delta`
- `message_created`
- `execution_update`
- `approval_requested`
- `action_auto_approved`
- `agent_error`
- `turn_complete`
- `session_title_updated`
- `session_event_created`
- `plan_step_updated`
- `plan_created`

Chat-scoped events include `sessionId`. Clients should ignore events for other chats and refresh messages/status after reconnect.

## Executions And Approvals

Tool calls create `executions` rows. Execution updates are broadcast over WebSocket and embedded back into `GET /sessions/:id/messages` so reloads can rehydrate tool cards.

Approval endpoints:

```txt
GET /executions/pending-approvals
GET /executions/:id
POST /executions/:id/approve
POST /executions/:id/reject
POST /executions/:id/cancel
```

Some actions are auto-approved according to the active permission profile. Push, project deletion, scheduled-task deletion, and strict-profile file writes can require user approval.

## Agent Orchestration

The lead agent uses Anthropic messages with tool calls. Coding work is delegated to isolated agent worktrees through:

- `invoke_claude_code`
- `invoke_codex`

Delegate session IDs are persisted eagerly via stream callbacks so interrupted long-running tasks can resume more reliably.

Sub-agents use `delegate_to_agent` with a configurable `max_turns` cap. Long-running async tools can return an execution id; `wait_for_execution` can block until that execution reaches `done` or `error`.

Research and GitHub integrations are MCP-based. Built-in `web_search`, `web_fetch`, and direct `github_api` tools are not active product surfaces. Agents discover MCP servers through `list_connections` and call them with `mcp_call`.

## Plans And Pipelines

Plans coordinate multi-step work in a Space. Steps can run in parallel when dependencies are satisfied. Space-scoped plan routes expose listing and detail; plan routes expose cancel and resume.

Pipelines are reusable Space-scoped workflow templates. `run_pipeline` instantiates a pipeline as a plan and dispatches it through the same plan machinery.

Scheduled tasks are polled by the scheduler and due tasks run in parallel. Individual task failures are logged without blocking remaining due tasks.

## Items

Items are the durable content model:

- `repo` Items link a repository path and default branch.
- `file` Items point at generated or attached files and retain MIME/size metadata.
- `note` Items store editable text or Markdown.
- `source_session_id`, `source_plan_id`, and `source_step_id` retain provenance.
- `generate_video` registers its rendered MP4 as a file Item.

Core endpoints:

```txt
GET /spaces/:spaceId/items
POST /spaces/:spaceId/items
GET /spaces/:spaceId/items/:itemId
PATCH /spaces/:spaceId/items/:itemId
DELETE /spaces/:spaceId/items/:itemId
GET /spaces/:spaceId/items/:itemId/content
```

## Data Directory

`DATA_DIR` controls runtime storage. If unset, the server uses the repo-level `data/` directory. Tests set `DATA_DIR=/tmp/unnamedproject-test`.
