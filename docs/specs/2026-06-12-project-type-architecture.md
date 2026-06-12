# Spec: Pluggable Project-Type Architecture

## Problem

Projects currently have one shape: a code repo with Overview/Campaigns/Files/Settings tabs, and `FileBrowser` assumes text/code content. As we add non-code project types (starting with video, per the Remotion spec), the project page needs to show type-appropriate tabs/widgets without forking the whole page per type or cramming every type's UI into the same components.

## Goals

- Projects gain a `type: string` field (e.g. `'default'`, `'video'`), defaulting to `'default'` for all existing rows.
- `ProjectPage` renders a shared shell (header, Overview, Settings — always present) plus a per-type set of additional tabs, driven by a frontend registry.
- The registry is the single extension point: adding a new project type means adding one entry to the registry, not editing `ProjectPage.tsx`'s control flow.
- Backend: `create_project` tool and `update_project` accept an optional `type`, validated against a known set of type IDs shared with the frontend registry.

## Non-goals

- Not building a generic plugin/marketplace system or dynamic loading of third-party tabs.
- Not changing Campaigns/Files/Settings behavior for `'default'` projects — must be 100% backward compatible.
- Not yet implementing the `'video'` type's actual tab content (that's the Remotion spec) — this spec only builds the extension point and proves it with one trivial example.

## Design

### Data model

`server/src/db/index.ts`:
- Add column via migration: `ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'default'`.
- `DbProject` gains `type: string`.
- `getProjectForUser` / `getProjectsForUser` SELECTs include `type`.

`web/src/types.ts`:
- `Project` gains `type: string`.

### Known project types (shared constant)

A single source of truth list of valid type IDs, used by both the tool input validation (backend) and the tab registry (frontend). Since backend and frontend don't share a module today, define it independently in each place but keep them in sync:
- `server/src/services/projectTypes.ts`: `export const PROJECT_TYPES = ['default', 'video'] as const;`
- `web/src/projectTypes.tsx`: the tab registry (below), whose keys ARE the valid types.

### Frontend tab registry

New file `web/src/projectTypes.tsx`:

```tsx
import type { ComponentType } from 'react';
import type { Project } from './types';

export interface ProjectTabDef {
  id: string;
  label: string;
  component: ComponentType<{ project: Project }>;
}

export interface ProjectTypeConfig {
  /** Tabs appended after the base tabs (Overview, Files), before Settings. */
  extraTabs: ProjectTabDef[];
}

export const PROJECT_TYPE_REGISTRY: Record<string, ProjectTypeConfig> = {
  default: {
    extraTabs: [],
  },
};
```

`'default'` keeps today's behavior (Overview, Campaigns, Files, Settings — Campaigns stays a special-cased base tab since every project type can run campaigns).

### `ProjectPage.tsx` changes

- `Tab` type becomes `string` instead of a fixed union (line 25).
- Base tabs (`overview`, `campaigns`, `files`, `settings`) stay defined inline as today.
- After building the base `TABS` array, splice in `PROJECT_TYPE_REGISTRY[project.type]?.extraTabs` (fallback to `PROJECT_TYPE_REGISTRY.default` if `project.type` is unknown) between `files` and `settings`.
- Render extra tab content by mapping over `extraTabs` and rendering `{tab === t.id && <t.component project={project} />}`.
- `tabFromPath`/`tabHref` (lines 34-44) just need their return type relaxed to `string` — logic (matching last URL segment) already works for arbitrary tab ids.

### Backend changes

- `server/src/services/projectTypes.ts`: exports `PROJECT_TYPES` array and `isValidProjectType(type: string): boolean`.
- `create_project` and `update_project` tool handlers (in `agent.ts`'s `dispatchTool`): accept optional `type` input; if provided, validate with `isValidProjectType`; if invalid, return an error string (don't throw — matches existing error-via-string pattern in `dispatchTool`'s catch). If omitted on create, default to `'default'`.
- `definitions.ts`: add `type: { type: 'string', description: "Project type, one of: 'default', 'video'. Defaults to 'default'." }` to `create_project` and `update_project`'s `input_schema.properties`.

### Validation example to prove the extension point

Add a trivial second type `'scratch'` with one extra tab ("Notes" — a static placeholder component) purely to prove the registry mechanism works end-to-end (registry entry → tab appears → tab content renders). This gets removed/replaced once the real `'video'` type lands in the Remotion spec — but for this spec's purposes it's the acceptance test. Implementation plan should make this trivial type removable in one diff.

Actually — simplify: don't ship a throwaway type. Instead, the plan's test for the registry is a frontend unit/component test that renders `ProjectPage` with a fake registry entry injected and asserts the extra tab + its content appear. No throwaway prod type needed.

## Acceptance criteria

- [ ] Existing projects (`type` defaulted to `'default'`) render identically to today — Overview/Campaigns/Files/Settings, same content.
- [ ] `create_project` tool accepts `type: 'video'` (or any value in `PROJECT_TYPES`) and persists it; rejects unknown types with a clear error.
- [ ] A unit test demonstrates that registering a new entry in `PROJECT_TYPE_REGISTRY` causes `ProjectPage` to render an additional tab with that entry's component.
- [ ] `npm run build` and `npm test` pass in both `server/` and `web/`.
