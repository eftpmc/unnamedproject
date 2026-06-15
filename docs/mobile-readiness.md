# Mobile Readiness Contract

This document captures the backend surface a first mobile client can rely on.

## Auth

- `POST /auth/login` returns `{ token }`.
- Send `Authorization: Bearer <token>` on all authenticated HTTP requests.
- `GET /auth/me` returns the current user email or `401` when the token is missing or invalid.
- Mobile should treat any `401` as signed-out and return to login.

## Chats

- `GET /sessions` lists recent chats.
- `POST /sessions` creates a chat.
- `PATCH /sessions/:id` updates title, effort, model, or pinned project.
- `DELETE /sessions/:id` deletes a chat.
- `GET /sessions/:id/status` returns active turn/execution state for reload recovery.
- `GET /sessions/:id/events` returns timeline events and linked projects.

## Messages And Attachments

- `GET /sessions/:id/messages` returns messages with `attachments` and persisted `executions`.
- `POST /sessions/:id/messages` accepts JSON `{ content }` for text-only messages.
- `POST /sessions/:id/messages` also accepts multipart form data with `content` and up to 8 `attachments`.
- Max attachment size is 10 MB.
- Supported attachments include common image, PDF, text, source, CSV, JSON, YAML, SQL, and markdown files.
- Attachment download URLs require the same bearer token.
- `DELETE /sessions/:id/messages/from/:messageId` truncates a conversation from a message and removes stored attachment files.

## Realtime

Mobile should connect to the existing WebSocket endpoint using the same auth token strategy as web.

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

Events that relate to a chat include `sessionId`; clients must ignore events for other chats. On reconnect, mobile should refresh `GET /sessions/:id/status` and `GET /sessions/:id/messages`.

## Projects And Artifacts

- `GET /projects` lists projects.
- `GET /projects/:id/artifacts` lists artifacts for a project.
- Artifact content/download URLs require auth.

## Campaigns And Long Work

- Campaign execution state is visible through campaign routes and message executions.
- Async tools such as `generate_video` return an execution id.
- Agents can use `wait_for_execution`; clients should use `/sessions/:id/status`, WebSocket events, and persisted executions for UI recovery.

## Mobile Client Defaults

- Prefer React Native/Expo for the first version to reuse TypeScript models and API logic.
- Use a single shared API client with token injection and `401` handling.
- Persist the token in secure storage, not ordinary async storage.
- Refresh messages/status when the app returns to foreground.
- Upload mobile images as compressed JPEG/PNG under 10 MB.
