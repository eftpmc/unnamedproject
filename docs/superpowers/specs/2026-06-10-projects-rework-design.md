# Workspaces → Projects Rework

## Goal

Generalize "workspaces" into "projects": a project may or may not have a
backing git repo on disk. The agent can create and manage projects itself
(no more "no workspaces configured, where should I put this?" dead ends),
but destructive actions (deleting a project) require user approval.

## Data model

- Rename `workspaces` table → `projects`:
  - `id`, `user_id`, `name`, `description`, `repo_path` (now **nullable**),
    `enabled_connection_ids`, `created_at`.
- New `user_settings` table: one row per user, `projects_root TEXT` —
  the base directory under which the agent creates new project repos
  (e.g. `/Users/zack/projects`). Editable in Settings UI. No default value;
  if unset, `create_project(with_repo: true)` returns an error telling the
  agent to ask the user to set it in Settings.
- `executions.workspace_id` → `executions.project_id` (FK to `projects`).
- Since the dev DB currently has 0 workspaces, this is a clean schema
  rename (drop + recreate), not a data migration.

## Agent tools

Add to `definitions.ts` and `dispatchTool` in `agent.ts`:

- **`create_project(name, description?, with_repo: boolean)`** — agent-approved
  (auto, logged like `invoke_claude_code`).
  - If `with_repo` is true: slugify `name`, create
    `<projects_root>/<slug>`, run `git init`, set `repo_path` to that dir.
    Errors if `projects_root` is unset or the dir already exists.
  - If `with_repo` is false: create the project row with `repo_path = NULL`
    (a notes/memory-only project).
  - Returns the new `project_id`.

- **`update_project(project_id, description?)`** — agent-approved. Only
  `description` is editable by the agent. Renaming or changing `repo_path`
  is not exposed (out of scope; avoids needing a second approval tier).

- **`delete_project(project_id, delete_files: boolean)`** — **user-approved**,
  using the existing `requestApproval` flow (same as `write_file` /
  `git push`). The approval payload includes the project name, `repo_path`,
  and the `delete_files` flag so the user sees exactly what will happen
  before approving. If approved and `delete_files` is true and `repo_path`
  is set, recursively removes that directory (`fs.rm(repo_path, {recursive:
  true, force: true})`) after deleting the DB row; if `delete_files` is
  false, only the DB row (and its `executions` rows via cascade) is removed.

Existing tools (`read_file`, `write_file`, `git_op`, `workspace_query`,
`invoke_claude_code`, `invoke_codex`) rename their `workspace_id` param to
`project_id`. Each gets a guard: if the resolved project has `repo_path =
NULL`, return an error string: `"Project '<name>' has no repo. Create a
new repo-backed project with create_project (with_repo=true) for this
work."` This is a clear, actionable error rather than a crash.

## System prompt changes (`buildSystemPrompt`)

- "Available workspaces" section → "Available projects:" with the same
  per-line format (`- name (id: ...)${desc}`), but show `repo_path`
  presence: `- name (id: xyz, no repo): description` vs
  `- name (id: xyz): description`.
- "No workspaces configured yet." → "No projects yet — create one with
  create_project when the user asks for project/code work."
- New guidance paragraph: when a task implies new code or files and no
  existing project fits, call `create_project` directly (pick a sensible
  name) rather than asking the user where to put things. Only ask if it's
  genuinely ambiguous which existing project a task belongs to.
- Approval tiers list: add `delete_project` to the "User-approved (pauses
  for user)" bullet, alongside `git push`, `github write ops`, `write_file`.

## API routes

- `server/src/routes/workspaces.ts` → `server/src/routes/projects.ts`,
  mounted at `/api/projects`.
  - `GET /api/projects` — list (same shape, `repo_path` may be `null`).
  - `POST /api/projects` — create (manual creation from UI; `repo_path`
    optional).
  - `DELETE /api/projects/:id` — existing direct-delete from UI stays
    (no approval needed for user-initiated UI actions — approval is only
    for the *agent's* `delete_project` tool).
- New `GET/PUT /api/settings` (or extend an existing settings route) for
  `projects_root`.

## Frontend

- `web/src/types.ts`: `Workspace` → `Project`, `repo_path?: string | null`.
- `web/src/lib/api.ts`: `getWorkspaces/createWorkspace/deleteWorkspace` →
  `getProjects/createProject/deleteProject`; add `getSettings/updateSettings`.
- Nav label "Workspaces" → "Projects" (icon unchanged).
- Project list/detail: show "No repo" badge when `repo_path` is null.
- Settings page: add a "Projects root" text field (path input) wired to
  `/api/settings`.

## Out of scope (for this spec)

- Graphify indexing/integration (separate spec).
- Structured/typed memory system (separate spec).
- Renaming projects or changing `repo_path` via agent tools.
- Multi-tier approval for project edits (only delete requires approval).
