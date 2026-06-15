# Current Architecture

Unnamed is a local agent workspace for chats, projects, campaigns, executions, artifacts, memory, and scheduled work.

## Runtime Shape

- `server/`: Express API, WebSocket server, SQLite data model, agent/tool orchestration, executions, campaigns, pipelines, artifacts, memory, scheduled tasks, and MCP process pooling.
- `web/`: React/Vite client with React Query, authenticated API calls, WebSocket updates, chat UI, project workspace, campaign views, artifacts, files, and settings.
- `remotion/`: shared Remotion renderer used by the `generate_video` tool.
- `data/`: local runtime storage for SQLite, project files, media, attachments, worktrees, and generated artifacts.

## Project Surface

Projects are capability-detected sandboxes. The UI keeps a stable set of project tabs:

- Overview
- Campaigns
- Chats
- Artifacts
- Files
- Settings

Generated outputs belong in Artifacts. This replaces earlier plans for project-type-specific Studio tabs and capability-specific Research tabs.

Detected capabilities currently include:

- Remotion availability from the shared `remotion/` app.
- Project media under `{DATA_DIR}/projects/{projectId}/media/`.
- Code graph availability from `.project-index.json` in the project repo.
- Legacy research notes under `{DATA_DIR}/projects/{projectId}/research/`.

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
- `campaign_task_updated`
- `campaign_created`

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

## Campaigns And Pipelines

Campaigns coordinate multi-task work against a project. Tasks can run in parallel when dependencies are satisfied. `run_campaign` returns counts and an `errors` array with failed task details.

Pipelines are reusable workflow templates. `run_pipeline` instantiates a pipeline as a campaign and dispatches it through the same campaign machinery.

Scheduled tasks are polled by the scheduler and due tasks run in parallel. Individual task failures are logged without blocking remaining due tasks.

## Artifacts

Artifacts are the durable review surface for inspectable work products:

- `create_artifact` writes DB-backed text artifacts.
- `register_artifact` copies generated files into project media storage and registers them.
- `generate_video` writes MP4 files under `{DATA_DIR}/projects/{projectId}/media/` and registers the rendered video as a media artifact.
- Existing markdown files under `{DATA_DIR}/projects/{projectId}/research/` are bridged into the artifact list as legacy research artifacts.

Generic artifact endpoints:

```txt
GET /projects/:id/artifacts
GET /projects/:id/artifacts/:artifactId/content
```

Compatibility routes:

```txt
GET /projects/:id/media
GET /projects/:id/media/:filename
GET /projects/:id/research
GET /projects/:id/research/:filename
```

New UI and clients should prefer Artifacts.

## Data Directory

`DATA_DIR` controls runtime storage. If unset, the server uses the repo-level `data/` directory. Tests set `DATA_DIR=/tmp/unnamedproject-test`.
