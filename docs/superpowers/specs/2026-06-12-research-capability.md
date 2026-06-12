# Research Capability — Design Spec

**Date:** 2026-06-12
**Status:** Approved

## Goal

When the orchestrator conducts deep research for a project (saving findings as markdown files), the app detects it and surfaces a Research tab where the user can browse and read the results. Follows the same detection → badge → tab pattern as `has_media` / `has_graph`.

## Orchestrator Convention

The orchestrator writes research output as `.md` files into:
```
{dataDir}/projects/{projectId}/research/
```

Each file is one research topic or session. Filenames become the display titles (e.g., `ai-inference-landscape.md` → "Ai Inference Landscape"). The orchestrator is responsible for deciding file names and content format.

## Detection

`server/src/services/projectCapabilities.ts`:
- `has_research`: check that `{dataDir}/projects/{projectId}/research/` exists and contains at least one `.md` file.

```ts
const researchDir = path.join(getDataDir(), 'projects', projectId, 'research');
const has_research = fs.existsSync(researchDir) &&
  fs.readdirSync(researchDir).some(f => f.endsWith('.md'));
```

Add `has_research: boolean` to the `ProjectCapabilities` interface.

## Orchestrator Context Hint

`server/src/services/context.ts` — add to the capabilities label list:
```ts
if (caps.has_research) capLabels.push('research saved — files in projects/{id}/research/');
```

This ensures the orchestrator knows where to write research and that it will surface in the UI.

## Server API

Two new endpoints in `server/src/routes/projects.ts`:

### `GET /projects/:id/research`

Returns the list of research files:
```json
{ "files": [{ "name": "ai-inference-landscape.md", "title": "Ai Inference Landscape", "createdAt": 1718200000000 }] }
```

`title` is derived from the filename: strip `.md`, replace hyphens/underscores with spaces, title-case.

Files sorted by `createdAt` descending (newest first).

### `GET /projects/:id/research/:filename`

Returns the raw markdown content of a single file as `text/plain`. Returns 404 if the file doesn't exist or is outside the research directory (path traversal guard: validate that the resolved path starts with `researchDir`).

## Client API

`web/src/lib/api.ts`:
- Add `has_research: boolean` to the `ProjectCapabilities` interface.
- Add `getResearchFiles(projectId: string): Promise<{ files: ResearchFile[] }>` function.
- Add `getResearchFile(projectId: string, filename: string): Promise<string>` function (returns raw text). This must use a plain `fetch` call rather than the `request()` JSON helper, since the endpoint returns `text/plain`. Pattern: `const r = await fetch(\`/api/projects/${projectId}/research/${filename}\`, { headers: { Authorization: ... } }); return r.text();`
- Add `ResearchFile` type: `{ name: string; title: string; createdAt: number }`.

## Research Tab Component

`web/src/components/ResearchTab.tsx` — `({ project }: { project: Project })`:

**Layout:** Two-panel on desktop (`flex`), single panel on mobile.

**Left panel** (file list, `w-56 shrink-0 border-r`):
- List of `ResearchFile` items, sorted newest first
- Each row: clickable button, `selectedFile === file.name` gets active highlight
- Shows `file.title` and `timeAgo(file.createdAt)`
- Loading state: skeleton rows

**Right panel** (content area, `flex-1 overflow-y-auto`):
- Fetches `getResearchFile(project.id, selectedFile)` when `selectedFile` changes
- Renders raw markdown as `<pre className="whitespace-pre-wrap text-sm ...">` — no markdown parsing library needed for v1 (plain text rendering is sufficient, prose layout for readability)
- Loading state: spinner
- Empty state (no file selected): `"Select a file to read"`

**State:**
- `selectedFile: string | null` — initialised to the first file's name on load

**Data fetching:**
- `useQuery(['research-files', project.id], () => getResearchFiles(project.id), { staleTime: 30_000 })`
- `useQuery(['research-file', project.id, selectedFile], () => getResearchFile(project.id, selectedFile!), { enabled: !!selectedFile, staleTime: 60_000 })`

## Hook

`web/src/hooks/useProjectCapabilities.ts`:
```ts
if (data?.has_research) {
  tabs.push({ id: 'research', label: 'Research', component: ResearchTab });
}
```

## Overview Badge

When `caps?.has_research`:
```tsx
<span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
  <FileText size={11} className="shrink-0" />
  research saved
</span>
```

Import `FileText` from `lucide-react`.

## Files Changed

| File | Change |
|---|---|
| `server/src/services/projectCapabilities.ts` | Add `has_research` detection |
| `server/src/services/context.ts` | Add research capability hint |
| `server/src/routes/projects.ts` | Add `/research` and `/research/:filename` endpoints |
| `web/src/lib/api.ts` | Add `has_research`, `ResearchFile`, `getResearchFiles`, `getResearchFile` |
| `web/src/hooks/useProjectCapabilities.ts` | Add research tab |
| `web/src/components/ResearchTab.tsx` | Create research file browser component |
| `web/src/pages/ProjectPage.tsx` | Add `FileText` import; overview badge added via caps (automatic) |
