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
  name TEXT NOT NULL,
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  source_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  source_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE space_repos (
  item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
  repo_path TEXT NOT NULL,
  default_branch TEXT
);

CREATE TABLE space_files (
  item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  size_bytes INTEGER,
  mime_type TEXT
);

CREATE TABLE space_notes (
  item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
  content TEXT NOT NULL
);
```

The subtype row shares the item ID and has a real foreign key back to `space_items`, so deleting an item cascades to its subtype data and subtype rows cannot exist without a parent item. Item creation and type changes are transactional: insert the `space_items` row and exactly one matching subtype row in the same transaction. Reads use `space_items.type` to join the matching subtype table on `item_id`.

The database cannot express "exactly one subtype matching `type`" with a normal foreign key, so the item service owns that invariant and migration/tests verify it. Item types are immutable after creation; changing type means deleting and recreating the item. Adding a new item type later means one additive migration (new type table + new `type` enum value) — existing rows/queries are unaffected.

**Provenance (`source_session_id`/`source_plan_id`/`source_step_id`):** every item creation happens inside some session — a chat, a subagent, or a pipeline's synthetic session — so `source_session_id` is set whenever the creating code has one; it is NULL only for items added directly through a UI action with no session context (e.g. attaching a repo from Settings). `source_plan_id`/`source_step_id` are set only when that session call happened as part of a plan step; both are NULL for plain-chat-generated items and for user-added items. These three columns replace the old `artifacts.source_plan_id`/`source_step_id`, plus fix a real gap in the old model where plain-chat-generated artifacts had no session linkage at all.

No `kind` or `status` columns are carried over from the old `artifacts` table:
- `kind` (a free-form tag like `'report'`/`'research'`) duplicated what `type` + `name` already answer — items don't need a second categorization axis.
- `status` (`ready/review/running/error`) duplicated `plan_steps.status` — an in-progress generation is the *step* not having finished yet, not the item being half-formed. The item is created once the step actually produces it; there's no item-level "running" state to track.

### Chats, Plans, Pipelines

These are Space-wide collections with no per-item scoping. `sessions.pinned_project_id` → `sessions.pinned_space_id`. `getPlansForProject()` and friends are renamed to their Space equivalents but keep their current Space-wide semantics.

Pipelines become Space-owned rather than user-wide:

```sql
CREATE TABLE pipelines (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

Pipeline CRUD is nested under `/spaces/:spaceId/pipelines`. Running a pipeline always creates a plan in that same Space; callers do not pass a separate Space ID.

### Artifacts table removal

The existing `artifacts` table (`id`, `project_id`, `kind`, `title`, `description`, `status`, `mime_type`, `path`, `url`, `metadata`, `source_plan_id`, `source_step_id`, `created_at`) is removed entirely — not just renamed. Trying to draw a line between "durable content" (Items) and "generated output" (Artifacts) breaks down as soon as the agent fully generates a repo, which is simultaneously both, so generated outputs become ordinary `space_items` rows with provenance set, not a parallel category:

- `create_artifact` tool (`server/src/tools/definitions.ts`, dispatched in `agent.ts:987-1000`) is removed. A text artifact becomes a `note` item: the markdown/text content lands in `space_notes.content`, `space_items.source_session_id`/`source_step_id` are set from the dispatch context.
- `renderVideo()` (`server/src/services/video.ts:77-86`) creates a `file` item instead of an `artifacts` row: the rendered file's path lands in `space_files.file_path`, provenance columns set the same way.
- `session_events.artifact_id` (`server/src/db/index.ts:300,655,680,793,865,890`) is renamed to `session_events.item_id`, referencing `space_items(id)` instead of `artifacts(id)`.
- `ArtifactsTab.tsx` and the kind-based filter UI it implements are deleted. The Items list view (this pass) filters by `type` (repo/file/note) only — no `kind` tagging, since `kind` isn't carried over (see above).
- `GET /projects/:id/artifacts` and `GET /projects/:id/artifacts/:artifactId/content` (`server/src/routes/projects.ts:145-165`) are removed; item content is served through `/spaces/:spaceId/items/:itemId/...` instead.

This pass ships `repo`/`file`/`note` as the only `space_items.type` values — no separate `'artifact'` type. Other types arrive later via the same additive migration pattern once their shape is actually needed.

## Migration plan

Added as migration v5 in `server/src/db/index.ts` / `server/src/db/migrate.ts`:

1. Rename `projects` → `spaces`.
2. Add `space_items` (with `source_session_id`/`source_plan_id`/`source_step_id`), `space_repos`, `space_files`, `space_notes` tables.
3. Backfill repos: for every existing Space with a non-null `repo_path`, create one `space_items` row (`type = 'repo'`) plus a `space_repos` row sharing its ID, then drop the `repo_path` column from `spaces`.
4. Backfill artifacts: for every row in `artifacts`, create a `space_items` row (`type = 'note'` if it had text `content`, `type = 'file'` if it had a `path`) with `source_plan_id`/`source_step_id` carried over, plus a matching `space_notes`/`space_files` row; then drop the `artifacts` table. `kind`, `status`, `mime_type`, and `metadata` are not carried over (see "Artifacts table removal").
5. Rename `session_events.artifact_id` → `session_events.item_id`, repointed at `space_items(id)`.
6. Rename all `project_id` FK columns (across `session_project_links` and other referencing tables) to `space_id`.
7. Rename `sessions.pinned_project_id` → `sessions.pinned_space_id`.
8. Replace `pipelines.user_id` with `pipelines.space_id`.

## API & route renames

- Routes: `/projects` → `/spaces`. Space-wide collections live at `/spaces/:spaceId/plans`, `/spaces/:spaceId/chats`, and `/spaces/:spaceId/pipelines`. Add `/spaces/:spaceId/items` for item list/CRUD.
- Filesystem and capability operations are item-scoped because a Space can contain multiple repos and files. Repo browsing uses `/spaces/:spaceId/items/:itemId/tree`, `/spaces/:spaceId/items/:itemId/file`, `/spaces/:spaceId/items/:itemId/workspace`, and `/spaces/:spaceId/items/:itemId/capabilities`. These routes reject an item that does not belong to the Space and reject operations unsupported by that item type.
- Media and research content produced within a repo is likewise addressed through the repo item (`/spaces/:spaceId/items/:itemId/media` and `/research`) rather than through an ambiguous Space root.
- Server functions: `getProjectForUser` → `getSpaceForUser`, `getProjectsForUser` → `getSpacesForUser`, `getProjectBasePath` → `getItemBasePath`, `resolveInProject` → `resolveInItem`, `getPlansForProject` → `getPlansForSpace`.
- Agent worktrees are keyed by `(repo_item_id, session_id)` rather than `(space_id, session_id)`, because a Space may contain multiple repositories. Any coding or git tool invocation must identify the target repo item explicitly; the UI may preselect when a Space contains exactly one repo.
- Web API client: project APIs are renamed to their `Space` equivalents; filesystem APIs accept both `spaceId` and `itemId`. `getProjectArtifacts` is removed (no replacement — folded into `getSpaceItems`, which returns provenance fields so the UI can show "generated by plan X" where applicable); add `getSpaceItems`/`createSpaceItem`/`deleteSpaceItem` and Space-scoped pipeline APIs.
- Web routes/pages: `ProjectsPage` → `SpacesPage` at `/spaces`, `ProjectPage` → `SpacePage` at `/spaces/:id`.
- Web types: `Project` → `Space`, add `SpaceItem` (discriminated union on `type`).

## Navigation redesign

No second sidebar. The existing global `Sidebar` (`web/src/components/Sidebar.tsx`) becomes contextual:

- **Outside a Space**: unchanged — global nav (Chats, Spaces, recents).
- **Inside a Space**: the same sidebar swaps its content to Space-scoped sections, with a switcher header at top (current Space name + chevron) that pops back to the Space list or jumps directly to another Space — the same pattern Vercel uses for its project sidebar, reusing one component rather than stacking two.
- Space-scoped sections, replacing the old 7 horizontal tabs:
  - **Overview** — dashboard/landing (not a separate route the user has to "tab into" — it's just what renders when you land in a Space), cards for recent chats, active plans, items.
  - **Chats** — Space-wide pinned chats (unchanged behavior).
  - **Items** — one list of all `space_items` (repo/file/note, mixing user-added and plan-generated rows) with type-specific icons and filter chips by `type`; an item with `source_plan_id` set shows "generated by plan X" rather than a separate kind tag. Opening one drills into its item-scoped detail (repository browser/workspace for a repo, file viewer for a file, editor for a note). No separate Artifacts section — generated outputs are items with provenance, not a parallel category.
  - **Plans** — expandable group; Pipelines becomes a sub-item under Plans rather than its own top-level section.
  - **Settings** — Space name, description, connections, delete (repo_path field removed; replaced by item management under Items).
- The horizontal tab bar in the old `ProjectPage` is removed entirely in favor of this sidebar-driven nav.

## Out of scope

- Per-item-scoped chats/plans (confirmed Space-wide only for this pass).
- Nesting Spaces within Spaces, or nesting items within items — items are a flat list per Space.
- New item types beyond `repo`/`file`/`note` — the schema supports adding them later via the same additive migration pattern, once their shape is actually needed.
- Re-adding `kind`-style free-form tagging or `status`-style generation-progress tracking to items — deliberately dropped, not deferred (see "Artifacts table removal").
- Visual polish of the Overview dashboard cards (covered by this restructure only at the "what sections exist" level, not pixel-level design).

## Testing considerations

- Migration v5 backfill correctness: existing `repo_path` data lands in `space_repos`/`space_items` (no data loss), and existing `artifacts` rows land in `space_notes`/`space_files` with `source_plan_id`/`source_step_id` preserved.
- Item invariant coverage: create/delete is transactional, subtype rows cascade on deletion, and mismatched or missing subtype rows are rejected.
- Item-scoped route authorization: an item ID cannot be accessed through another Space ID, and unsupported item-type operations return a clear 4xx response.
- Multi-repo coverage: tree/file/workspace/capability and agent-worktree operations target the requested repo item rather than an arbitrary Space root.
- Space-owned pipeline coverage: pipeline CRUD is isolated by Space and pipeline runs create plans in the owning Space.
- Provenance coverage: `create_artifact`-replacement item creation from a plain chat session sets `source_session_id` with `source_plan_id`/`source_step_id` left NULL; item creation from a plan step sets all three.
- `session_events.item_id` correctly references `space_items(id)` post-rename, including for events created before the migration ran.
- Renamed route/function coverage — existing server tests (`server/tests/`) referencing `project` or `artifacts` endpoints need updating to `space`/`space_items` equivalents.
- Sidebar context-switch behavior (entering/leaving a Space swaps sidebar content correctly, switcher navigates between Spaces without a full page reload feel).
