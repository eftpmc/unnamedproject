# Task 1 Report: Delete item/blocks/schema/capabilities/DAG subsystem

## Status: COMPLETE

## What was deleted

**Service files (git rm):**
- `server/src/lib/blocks.ts`, `blocks.test.ts`
- `server/src/lib/item-schema.ts`, `item-schema.test.ts`
- `server/src/mcp/handlers/items.ts`
- `server/src/mcp/handlers/schedules.ts`
- `server/src/routes/scheduled_tasks.ts`
- `server/src/routes/spaces-items.test.ts`
- `server/src/services/capabilities.ts`, `capabilities.test.ts`
- `server/src/services/items.ts`, `items.test.ts`
- `server/src/services/scheduled_tasks.ts`
- `server/src/services/templates.ts`
- `server/src/tools/item_ops.ts`, `item_ops.test.ts`

**Test files for removed functionality (git rm):**
- `tests/services/items.test.ts`, `scheduled_tasks.test.ts`, `scheduler.test.ts`
- `tests/services/toolRegistry.test.ts`, `toolSearch.test.ts`, `agent_pipeline.test.ts` (source files deleted in prior commit)
- `tests/scheduled-tasks-route.test.ts`
- `tests/lib/worktree.test.ts`
- `tests/db/migration-v5.test.ts`
- `tests/tools/run_command.test.ts`, `file_ops.test.ts` (source tools no longer exist)
- `tests/tools/definitions.test.ts` (source deleted in prior commit)

## Key rewrites

**`services/context.ts`**: Replaced item/runbook/capabilities doctrine with projects+documents+triggers doctrine. `buildContext` now calls `listProjects` and `listDocuments` instead of `getItemsForSpace`.

**`services/scheduler.ts`**: Replaced full scheduler with no-op stub (polls once per hour, does nothing). Trigger runner wired in Task 5.

**`services/agent.ts`**: Removed `checkpointWorkspaceMd` call (wrote workspace.md on every turn).

**`routes/spaces.ts`**: Stripped all item/template/file-upload endpoints. Now space CRUD only (GET, POST, PATCH, DELETE).

**`routes/sessions.ts`**: Three worktree queries updated from `item_id`/`space_items` joins to `project_id`/`projects` joins.

**`routes/auth.ts`**: Removed `createScheduledTask` call on register.

**`tools/project_query.ts`**: Uses `getProject` from projects service instead of `getItemById`.
**`tools/project_ops.ts`**: Uses `listProjects` from projects service instead of `getItemsForSpace`.
**`tools/project_ops.ts`**: `createProject` inserts into `projects` table; `deleteProject` gets repo paths from projects service.

**`mcp/handlers/index.ts`**: Removed `registerItemHandlers`, `registerScheduleHandlers`.
**`mcp/handlers/git.ts`**: Uses `getProject` instead of `getItemById`.
**`mcp/handlers/knowledge.ts`**: Dynamic import switched to `services/projects.js`.
**`lib/worktree.ts`**: Replaced `SpaceItemBase` type dependency with inline `WorktreeRepoItem` interface.

**`db/index.ts`**: Removed `DbScheduledTask` and all 7 scheduled-task DB functions. Added migration v25 which:
1. Rebuilds `agent_worktrees` with `project_id REFERENCES projects(id)` instead of `item_id REFERENCES space_items(id)`.
2. Rebuilds `session_events` to drop the dangling FK `item_id REFERENCES space_items(id)` left by migration v22 — without this, any `DELETE FROM sessions` prepare() failed with "no such table: main.space_items" because SQLite validates the cascade chain at prepare time.

## Test files updated

- `tests/tools/project_query.test.ts`: Mocks `services/projects.js` / `getProject` instead of deleted `services/items.js`.
- `tests/tools/project_ops.test.ts`: Mock `services/projects.js` / `listProjects` for repo-path deletion; `getDb` mock handles `INSERT INTO projects`.
- `tests/services/context.test.ts`: Updated 4 assertions to match new doctrine text; replaced 2 old item-based tests with new document/projects-based checks.
- `tests/sessions-new.test.ts`: Worktree setup inserts into `projects` + `agent_worktrees.project_id` instead of `space_items` + `item_id`.
- `tests/routes/spaces.ts`: Removed 3 deleted item-route tests; added PATCH/DELETE tests.
- `tests/mcp/handlers.test.ts`: Removed `item handlers` describe block (tests deleted `list_items`).
- `tests/auth.test.ts`: Removed `scheduled_tasks` assertion.
- `tests/connections.test.ts`: Removed MCP tool ingestion test (backend ingestion path deleted).

## Result

- `npx tsc --noEmit`: clean (0 errors)
- `npx vitest run`: 47 test files, 230 tests — all pass
- No source file imports `services/items.js`, `services/templates.js`, `lib/blocks.js`, `lib/item-schema.js`, `services/capabilities.js`, `services/scheduled_tasks.js`, or `tools/item_ops.js`
