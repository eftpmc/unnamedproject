# Spaces rename & navigation redesign

## Motivation

"Project" implies a single git repo with code. In practice a project container is used for arbitrary mixes of content (a repo, loose files, notes), and the `ProjectPage` view has grown to 7 flat top-level tabs (Overview, Plans, Chats, Files, Artifacts, Pipelines, Settings), which feels cluttered. This rename + restructure makes the container name match what it actually holds, and reorganizes navigation so it scales as more item types are added.

## Scope

Full rename, including the DB layer and API routes — not a UI-label-only change. `project` as an identifier is retired everywhere (DB tables/columns, API routes, function names, types, UI strings) in favor of `space`.

## Data model

### Spaces table (renamed from `projects`)

```sql
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  enabled_connection_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, name)
);
```

`repo_path` is removed from this table — repos become items (below), since a Space can hold more than one.

### Space items (new)

A Space holds a list of typed items. Items are heterogeneous in shape (a repo needs a path/branch, a file needs a path/size, a note needs content), so each type gets its own table. A thin index table (`space_items`) provides cheap "list everything in this Space, ordered by recency, mixed types" queries without a fan-out/UNION across type tables.

```sql
CREATE TABLE space_items (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('repo','file','note')),
  ref_id TEXT NOT NULL,        -- points into the type-specific table below
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE space_repos (
  id TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  default_branch TEXT
);

CREATE TABLE space_files (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  size_bytes INTEGER,
  mime_type TEXT
);

CREATE TABLE space_notes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL
);
```

Opening an item: look up its `space_items` row for `type`, then join to the matching type table via `ref_id`. Adding a new item type later means one additive migration (new type table + new `type` enum value) — existing rows/queries are unaffected.

### Chats, Plans, Artifacts, Pipelines

These stay Space-wide collections, unchanged in relationship — no per-item scoping. `sessions.pinned_project_id` → `sessions.pinned_space_id`. `getPlansForProject()` and friends are renamed to their Space equivalents but keep their current Space-wide semantics.

## Migration plan

Added as migration v5 in `server/src/db/index.ts` / `server/src/db/migrate.ts`:

1. Rename `projects` → `spaces`.
2. Add `space_items`, `space_repos`, `space_files`, `space_notes` tables.
3. Backfill: for every existing Space with a non-null `repo_path`, create one `space_repos` row + one `space_items` row (`type = 'repo'`) pointing at it, then drop the `repo_path` column from `spaces`.
4. Rename all `project_id` FK columns (across `session_project_links` and other referencing tables) to `space_id`.
5. Rename `sessions.pinned_project_id` → `sessions.pinned_space_id`.

## API & route renames

- Routes: `/projects` → `/spaces`, `/projects/:id/*` → `/spaces/:id/*` (tree, file, plans, capabilities, artifacts, workspace, media, research stay as sub-resources, just re-rooted). Add `/spaces/:id/items` for the new item list/CRUD.
- Server functions: `getProjectForUser` → `getSpaceForUser`, `getProjectsForUser` → `getSpacesForUser`, `getProjectBasePath` → `getSpaceBasePath`, `resolveInProject` → `resolveInSpace`, `getPlansForProject` → `getPlansForSpace`.
- Web API client: `getProjects`/`createProject`/`deleteProject`/`updateProject`/`getProjectTree`/`getProjectFile`/`getProjectPlans`/`getProjectCapabilities`/`getProjectArtifacts` all renamed to their `Space` equivalents; add `getSpaceItems`/`createSpaceItem`/`deleteSpaceItem`.
- Web routes/pages: `ProjectsPage` → `SpacesPage` at `/spaces`, `ProjectPage` → `SpacePage` at `/spaces/:id`.
- Web types: `Project` → `Space`, add `SpaceItem` (discriminated union on `type`).

## Navigation redesign

No second sidebar. The existing global `Sidebar` (`web/src/components/Sidebar.tsx`) becomes contextual:

- **Outside a Space**: unchanged — global nav (Chats, Spaces, recents).
- **Inside a Space**: the same sidebar swaps its content to Space-scoped sections, with a switcher header at top (current Space name + chevron) that pops back to the Space list or jumps directly to another Space — the same pattern Vercel uses for its project sidebar, reusing one component rather than stacking two.
- Space-scoped sections, replacing the old 7 horizontal tabs:
  - **Overview** — dashboard/landing (not a separate route the user has to "tab into" — it's just what renders when you land in a Space), cards for recent chats, active plans, items, artifacts.
  - **Chats** — Space-wide pinned chats (unchanged behavior).
  - **Items** — expandable group; lists all `space_items` (repos/files/notes) with type-specific icons; opening one drills into its detail (file browser for a repo/file item, editor for a note).
  - **Plans** — expandable group; Pipelines becomes a sub-item under Plans rather than its own top-level section.
  - **Artifacts** — generated outputs (code, designs, media) produced by agent runs; stays its own section since it's agent-produced output, not something the user attaches the way Items are.
  - **Settings** — Space name, description, connections, delete (repo_path field removed; replaced by item management under Items).
- The horizontal tab bar in the old `ProjectPage` is removed entirely in favor of this sidebar-driven nav.

## Out of scope

- Per-item-scoped chats/plans/artifacts (confirmed Space-wide only for this pass).
- Nesting Spaces within Spaces, or nesting items within items — items are a flat list per Space.
- New item types beyond `repo`/`file`/`note` (the schema supports adding them later without further redesign).
- Visual polish of the Overview dashboard cards (covered by this restructure only at the "what sections exist" level, not pixel-level design).

## Testing considerations

- Migration v5 backfill correctness (existing `repo_path` data lands in `space_repos`/`space_items`, no data loss).
- Renamed route/function coverage — existing server tests (`server/tests/`) referencing `project` endpoints need updating to `space` equivalents.
- Sidebar context-switch behavior (entering/leaving a Space swaps sidebar content correctly, switcher navigates between Spaces without a full page reload feel).
