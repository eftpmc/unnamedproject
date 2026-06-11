# Memory Rework: Typed Memory + Scheduled Tasks

## Goal

Replace the flat key-value `user_memory` table with a typed memory store the
agent curates itself, and add a lightweight generic scheduled-task system
whose first job is a daily "reorganize memory" session.

## Memory schema

Replace `user_memory` with `memories`:

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('user','feedback','project','reference')),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, type, key)
);
```

- `type`:
  - `user` — durable facts/preferences about the user or their environment
    (timezone, stack, accounts).
  - `feedback` — corrections/guidance on how the agent should do work
    ("don't use npm, use pnpm", "keep responses terse").
  - `project` — context tied to a specific project, `project_id` set.
  - `reference` — pointers to external systems (issue trackers, dashboards).
- `key` is a short identifier (e.g. `package_manager`, `timezone`); `value`
  is the freeform fact/note.
- `project_id` only set/used for `type='project'` entries.
- This is a clean rebuild (drop + recreate), same as the `workspaces` →
  `projects` rename — no real data exists yet to migrate.

## Memory tools

Replace `remember`/`recall`, add `forget`. All three are agent-approved
(automatic, logged) — same tier as `create_project`/`update_project`.

- **`remember(type, key, value, project_id?)`** — upserts on
  `(user_id, type, key)`. `project_id` only used/required when
  `type='project'`.
- **`recall(type?, key?)`** — returns matching entries. No args returns all
  entries grouped by type. Used by the agent mid-conversation and by the
  reorganize job.
- **`forget(type, key)`** — deletes an entry by `(type, key)`.

Tool descriptions explain the taxonomy so the agent categorizes sensibly
(e.g. "use `feedback` when the user corrects your approach or expresses a
process preference").

## System prompt integration

`recallAll(userId)` returns entries grouped by type. `buildSystemPrompt`
renders a labeled list:

```
User memory:
- [user] timezone: PST
- [feedback] package_manager: use pnpm, not npm
- [project: demo] auth refactor blocked on legal review
- [reference] bug_tracker: Linear project "INGEST"
```

`project` entries resolve `project_id` to the project's name (falling back
to the raw id if the project no longer exists). If there are no entries,
render `"No memories stored yet."` (replacing the current empty-string
omission, so the agent is aware the capability exists).

No truncation/limiting logic — keeping this list small is the reorganize
job's responsibility.

## Scheduled tasks

```sql
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  interval_hours INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

- **Scheduler**: in-process `setInterval` (every 5 minutes) selects
  `WHERE enabled=1 AND next_run_at <= unixepoch()`, runs each due task, then
  sets `last_run_at = now` and `next_run_at = now + interval_hours*3600`.
- **Bootstrapping**: on user registration, insert a `reorganize_memory` task
  with `interval_hours = 24`, `enabled = 1`, `next_run_at = now + 24h`.
- **Running a task** is dispatched by `type`. For `reorganize_memory`:
  create a new session titled `"Memory reorganization — <date>"`, insert a
  system-authored user message containing the kickoff prompt below, then
  call the existing `runAgentTurn(userId, sessionId, messageId)`. The session
  appears in the normal sessions list like any other session.
- **API**:
  - `GET /api/scheduled-tasks` — list the user's tasks.
  - `PATCH /api/scheduled-tasks/:id` — update `enabled` and/or
    `interval_hours`.
  - `POST /api/scheduled-tasks/:id/run` — run immediately (bypasses
    schedule; updates `last_run_at`/`next_run_at` same as a normal run).

### Reorganize-memory kickoff prompt

```
Review your stored memory using `recall`. Look for: duplicate or
overlapping entries to merge, outdated/stale facts to `forget`, vague
entries that should be split into more specific ones, and entries that
should be re-typed (e.g. a `feedback` note that's actually a durable `user`
fact). Use `remember`/`forget` to apply changes. Reply with a short summary
of what you changed (or "No changes needed" if memory is already tidy).
```

## Frontend

- `web/src/types.ts`: add `Memory { type, key, value, project_id }` and
  `ScheduledTask { id, type, interval_hours, enabled, next_run_at,
  last_run_at }`.
- `web/src/lib/api.ts`: replace `getMemory` with a typed equivalent; add
  `getScheduledTasks`, `updateScheduledTask`, `runScheduledTask`.
- Settings page:
  - **Memory section**: entries grouped by type under headers (`User`,
    `Feedback`, `Project`, `Reference`); each row shows `key: value` (project
    entries also show the linked project's name). Read-only — no manual
    add/edit UI (agent-managed).
  - **Scheduled tasks section**: lists tasks (initially just "Memory
    reorganization"), showing last-run time, an enabled/disabled toggle, and
    a "Run now" button.

## Out of scope

- Wiki-style long-form memory pages (considered, deferred).
- Additional scheduled task types beyond `reorganize_memory` (the system is
  generic/extensible, but no other job types are implemented now).
- Manual create/edit/delete of memory entries from the UI.
- Cron-expression scheduling (fixed `interval_hours` only).
