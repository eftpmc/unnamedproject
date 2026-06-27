# Web UI for Projects / Documents / Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the web app around the Plan 1/2 backend: Spaces with Documents (markdown, frontmatter, tracker views), Projects (git repos with a file browser), Triggers (automation), and Chats. Delete the block editor and all item/template/block UI. This is **Plan 3 of 3**. Requires Plans 1 and 2 merged.

**Architecture:** React + react-router + @tanstack/react-query, shadcn-style UI in `web/src/components/ui`. Documents render/edit as markdown (ReactMarkdown + remark-gfm, already deps). A "tracker" is a frontend grouping of `list_documents` by `status`. The old polymorphic `SpaceItem`/`Block` model is removed from `types.ts` and `api.ts`.

**Tech Stack:** React, TypeScript, react-query, react-router-dom, ReactMarkdown, remark-gfm, lucide-react, Vitest + Testing Library (matching existing `*.test.tsx`).

## Global Constraints

- Match existing UI primitives in `web/src/components/ui/*` (Button, Input, Dialog, Select, TabStrip, app-layout). Do not introduce a new component library.
- Routes live in `web/src/App.tsx`. Item routes are replaced, not added alongside.
- API base/auth helpers live in `web/src/lib/api.ts` — reuse the existing `apiFetch`/token pattern already used by `getSpaces` etc.
- After this plan, no web file imports `Block`, `SpaceItem`, `RepoItem`, `FileItem`, `ItemTemplate`, or `BlockRenderer`.

---

## File Structure

- **Delete:** `web/src/components/BlockRenderer.tsx`, `web/src/components/BlockRenderer.test.tsx`. Repurpose/remove `FileBrowser.tsx` only if unused after Projects rewrite (it is reused — keep, repoint props from item→project).
- **Modify:** `web/src/types.ts` (remove block/item types; add `Document`, `Project`, `Trigger`), `web/src/lib/api.ts` (swap item fns for document/project/trigger fns), `web/src/pages/SpacePage.tsx` (rewrite sections), `web/src/App.tsx` (routes), `web/src/components/ChatView.tsx` + `ContextPanel.tsx` + `MessageList.tsx` + `pages/SpacesPage.tsx` + `pages/Settings.tsx` (drop item references), and their `.test.tsx`.
- **Create:** `web/src/components/DocumentView.tsx` (markdown read/edit), `web/src/pages/DocumentPage` section + `web/src/components/TrackerView.tsx` (grouped-by-status board), `web/src/components/TriggersSection.tsx`.

---

## Task 1: Replace item types with Document / Project / Trigger in `types.ts`

**Files:**
- Modify: `web/src/types.ts`

**Interfaces:**
- Produces:

```typescript
export interface Document {
  id: string;
  space_id: string;
  path: string;
  title: string;
  type: string | null;
  status: string | null;
  frontmatter: Record<string, unknown>;
  source_session_id: string | null;
  created_at: number;
  updated_at: number;
}
export interface DocumentWithBody extends Document { body: string; }

export interface Project {
  id: string;
  space_id: string;
  name: string;
  repo_path: string;
  default_branch: string | null;
  origin: 'created' | 'linked';
  created_at: number;
}

export interface Trigger {
  id: string;
  space_id: string;
  kind: 'schedule' | 'webhook' | 'manual';
  schedule_cron: string | null;
  playbook_id: string | null;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
}
```

- [ ] **Step 1: Delete the old types**

Remove `BlockContent`, `Block`, `SpaceItemBase`, `RepoItem`, `FileItem`, `SpaceItem`, `ItemTemplate` from `web/src/types.ts`. Update `SessionEventType` union: replace `'item_created' | 'item_updated'` with `'document_created' | 'document_updated' | 'project_created'`.

- [ ] **Step 2: Add the new types**

Paste the `Document`/`DocumentWithBody`/`Project`/`Trigger` interfaces above into `types.ts`.

- [ ] **Step 3: Typecheck (expected to fail elsewhere)**

Run: `cd web && npx tsc --noEmit`
Expected: errors ONLY in files still importing removed types (fixed in later tasks). No errors inside `types.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts
git commit -m "refactor(web): replace item/block types with Document/Project/Trigger"
```

---

## Task 2: Swap API client functions in `lib/api.ts`

**Files:**
- Modify: `web/src/lib/api.ts`, `web/src/lib/api.test.ts`

**Interfaces:**
- Produces (reusing the file's existing `apiFetch` helper and base URL):

```typescript
export function getDocuments(spaceId: string, params?: { type?: string }): Promise<Document[]>;
export function getDocument(spaceId: string, docId: string): Promise<DocumentWithBody>;
export function createDocument(spaceId: string, body: { path: string; title: string; frontmatter?: Record<string, unknown>; body: string }): Promise<Document>;
export function updateDocument(spaceId: string, docId: string, body: { title?: string; body?: string; frontmatter?: Record<string, unknown> }): Promise<Document>;
export function deleteDocument(spaceId: string, docId: string): Promise<void>;

export function getProjects(spaceId: string): Promise<Project[]>;
export function createProject(spaceId: string, body: { name: string }): Promise<Project>;
export function linkProject(spaceId: string, body: { name: string; repo_path: string; default_branch?: string }): Promise<Project>;
export function deleteProject(spaceId: string, projectId: string): Promise<void>;
export function getProjectTree(spaceId: string, projectId: string, dirPath?: string): Promise<{ entries: { name: string; type: 'file' | 'dir'; path: string }[] }>;
export function getProjectFile(spaceId: string, projectId: string, filePath: string): Promise<{ content: string; path: string }>;

export function getTriggers(spaceId: string): Promise<Trigger[]>;
export function createTrigger(spaceId: string, body: { kind: Trigger['kind']; schedule_cron?: string; playbook_id?: string }): Promise<Trigger>;
export function deleteTrigger(spaceId: string, triggerId: string): Promise<void>;
```

- [ ] **Step 1: Remove the old functions**

Delete from `api.ts`: `getSpaceItems`, `createSpaceItem`, `listItemTemplates`, `createItemTemplate`, `updateItemTemplate`, `deleteSpaceItem`, `getSpaceItem`, `getItemSessions`, `updateSpaceItem`, `deleteItemTemplate`, `updateItemTask`, `getItemContent`, `getItemTree`, `getItemFile`, `getItemWorkspace`, `updateItemWorkspace`, `getItemCapabilities`, `getItemFiles`, `uploadItemFile`, `deleteItemFile`, and the `ItemFile` type/import. Keep `getItemSessions` ONLY if you re-point it to documents; otherwise remove. Also remove the now-dead scheduled-task client fns (`createScheduledTask`/`updateScheduledTask`) — replaced by trigger fns.

- [ ] **Step 2: Add the new functions**

Implement the signatures above using the existing `apiFetch` pattern, e.g.:

```typescript
export function getDocuments(spaceId: string, params?: { type?: string }): Promise<Document[]> {
  const q = params?.type ? `?type=${encodeURIComponent(params.type)}` : '';
  return apiFetch(`/spaces/${spaceId}/documents${q}`);
}
export function createDocument(spaceId: string, body: { path: string; title: string; frontmatter?: Record<string, unknown>; body: string }): Promise<Document> {
  return apiFetch(`/spaces/${spaceId}/documents`, { method: 'POST', body: JSON.stringify(body) });
}
// ...remaining per the signatures, matching the verb/path table in Plan 2 Task 6.
```

Import `Document`, `DocumentWithBody`, `Project`, `Trigger` from `../types.js`.

- [ ] **Step 3: Update `api.test.ts`**

Remove tests for deleted fns; add a minimal test for `getDocuments` URL construction mirroring existing patterns in the file.

- [ ] **Step 4: Run web tests + typecheck**

Run: `cd web && npx vitest run src/lib/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/api.test.ts
git commit -m "refactor(web): document/project/trigger API client"
```

---

## Task 3: Delete BlockRenderer, add DocumentView (markdown read/edit)

**Files:**
- Delete: `web/src/components/BlockRenderer.tsx`, `web/src/components/BlockRenderer.test.tsx`
- Create: `web/src/components/DocumentView.tsx`, `web/src/components/DocumentView.test.tsx`

**Interfaces:**
- Produces: `<DocumentView spaceId doc onSaved />` where `doc: DocumentWithBody`. Shows rendered markdown; an Edit toggle swaps to a `<textarea>`; Save calls `updateDocument(spaceId, doc.id, { body })` and invokes `onSaved`.

- [ ] **Step 1: Delete the block files**

```bash
cd web && git rm src/components/BlockRenderer.tsx src/components/BlockRenderer.test.tsx
```

- [ ] **Step 2: Write the failing DocumentView test**

```tsx
// web/src/components/DocumentView.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DocumentView from './DocumentView.js';

vi.mock('../lib/api.js', () => ({ updateDocument: vi.fn(async () => ({})) }));
import { updateDocument } from '../lib/api.js';

const doc = { id: 'd1', space_id: 's1', path: 'a.md', title: 'A', type: null, status: null, frontmatter: {}, source_session_id: null, created_at: 0, updated_at: 0, body: '# Hello' };

describe('DocumentView', () => {
  it('renders markdown then edits and saves', async () => {
    render(<DocumentView spaceId="s1" doc={doc} onSaved={() => {}} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '# Changed' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(updateDocument).toHaveBeenCalledWith('s1', 'd1', { body: '# Changed' }));
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx vitest run src/components/DocumentView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement DocumentView**

```tsx
// web/src/components/DocumentView.tsx
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { updateDocument } from '../lib/api.js';
import type { DocumentWithBody } from '../types.js';

export default function DocumentView({ spaceId, doc, onSaved }: { spaceId: string; doc: DocumentWithBody; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(doc.body);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try { await updateDocument(spaceId, doc.id, { body }); onSaved(); setEditing(false); }
    finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end gap-2">
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => { setBody(doc.body); setEditing(false); }}>Cancel</Button>
            <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
        )}
      </div>
      {editing ? (
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={24}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
```

> If the `prose` Tailwind classes aren't available, reuse the inline markdown styling block already present in `SpacePage.tsx`'s `TemplateItemDetail` (the long `[&_h1]:...` string) instead.

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run src/components/DocumentView.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/components/DocumentView.tsx web/src/components/DocumentView.test.tsx
git commit -m "feat(web): markdown DocumentView; remove BlockRenderer"
```

---

## Task 4: TrackerView (documents grouped by status)

**Files:**
- Create: `web/src/components/TrackerView.tsx`, `web/src/components/TrackerView.test.tsx`

**Interfaces:**
- Produces: `<TrackerView documents onOpen />` — groups `Document[]` by `status` (null → "No status") into columns; clicking a card calls `onOpen(doc)`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/TrackerView.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TrackerView from './TrackerView.js';

const docs = [
  { id: '1', space_id: 's', path: 'a.md', title: 'Acme', type: 'application', status: 'applied', frontmatter: {}, source_session_id: null, created_at: 0, updated_at: 0 },
  { id: '2', space_id: 's', path: 'b.md', title: 'Beta', type: 'application', status: 'interview', frontmatter: {}, source_session_id: null, created_at: 0, updated_at: 0 },
];

describe('TrackerView', () => {
  it('renders a column per status', () => {
    render(<TrackerView documents={docs} onOpen={() => {}} />);
    expect(screen.getByText('applied')).toBeInTheDocument();
    expect(screen.getByText('interview')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/TrackerView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// web/src/components/TrackerView.tsx
import type { Document } from '../types.js';

export default function TrackerView({ documents, onOpen }: { documents: Document[]; onOpen: (doc: Document) => void }) {
  const groups = new Map<string, Document[]>();
  for (const d of documents) {
    const key = d.status ?? 'No status';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {[...groups.entries()].map(([status, docs]) => (
        <div key={status} className="flex w-64 shrink-0 flex-col gap-2">
          <div className="text-xs font-semibold text-muted-foreground">{status} <span className="text-faint-fg">{docs.length}</span></div>
          {docs.map(doc => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onOpen(doc)}
              className="rounded-lg border border-border-soft bg-card px-3 py-2 text-left text-sm transition-colors hover:border-border"
            >
              <div className="truncate font-medium">{doc.title}</div>
              {doc.type && <div className="text-[11px] text-faint-fg capitalize">{doc.type}</div>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run src/components/TrackerView.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TrackerView.tsx web/src/components/TrackerView.test.tsx
git commit -m "feat(web): TrackerView — documents grouped by status"
```

---

## Task 5: Rewrite SpacePage around Documents / Projects / Triggers / Chats

**Files:**
- Modify: `web/src/pages/SpacePage.tsx`, `web/src/App.tsx`, `web/src/pages/SpacePage.test.tsx`

**Interfaces:**
- Consumes Task 2 API fns + Task 3/4 components + the existing `FileBrowser` (repointed to projects).
- Tabs: `overview | documents | projects | triggers | chats | settings`.

- [ ] **Step 1: Update routes in `App.tsx`**

Replace the item routes:

```tsx
{ path: 'spaces/:spaceId', element: <SpacePage /> },
{ path: 'spaces/:spaceId/chats', element: <SpacePage /> },
{ path: 'spaces/:spaceId/documents', element: <SpacePage /> },
{ path: 'spaces/:spaceId/documents/:docId', element: <SpacePage /> },
{ path: 'spaces/:spaceId/projects', element: <SpacePage /> },
{ path: 'spaces/:spaceId/projects/:projectId', element: <SpacePage /> },
{ path: 'spaces/:spaceId/triggers', element: <SpacePage /> },
{ path: 'spaces/:spaceId/settings', element: <SpacePage /> },
```

- [ ] **Step 2: Rewrite `SpacePage.tsx` section routing**

Update `Section` type to `'overview' | 'documents' | 'projects' | 'triggers' | 'chats' | 'settings'` and `sectionFromPath` accordingly. Replace `useParams` `itemId` with `docId`/`projectId`. Replace the `space-items` query with:

```tsx
const { data: documents = [] } = useQuery({ queryKey: ['documents', spaceId], queryFn: () => getDocuments(spaceId!), enabled: !!spaceId });
const { data: projects = [] } = useQuery({ queryKey: ['projects', spaceId], queryFn: () => getProjects(spaceId!), enabled: !!spaceId });
```

Replace the WS invalidation effect's `item_created|item_updated` with `document_created|document_updated|project_created`, invalidating `['documents', spaceId]` / `['projects', spaceId]`.

- [ ] **Step 3: Implement the sections**

- **DocumentsSection**: a list + a "Tracker" toggle. When a `type` filter with statuses is active, render `<TrackerView documents onOpen={doc => navigate(.../documents/${doc.id})} />`; otherwise a flat list (reuse the existing card markup, swapping `item`→`doc`, showing `doc.type`/`doc.status`/`timeAgo(doc.updated_at)`). "Add document" dialog → `createDocument(spaceId, { path, title, frontmatter: { type }, body: '' })`.
- **DocumentDetail** (when `docId` set): `useQuery(['document', spaceId, docId], () => getDocument(...))` → render `<DocumentView>` plus an editable frontmatter strip (reuse the inline-fields markup from the old `TemplateItemDetail`, but values come from `doc.frontmatter`; editing a field calls `updateDocument(spaceId, docId, { frontmatter: { [k]: v } })`).
- **ProjectsSection**: list `projects`; "Create project" → `createProject`; "Link project" → `linkProject`. ProjectDetail (when `projectId` set): the repo path header + `<FileBrowser spaceId={spaceId} projectId={project.id} />` (repoint FileBrowser props from `itemId`→`projectId` and its fetch calls to `getProjectTree`/`getProjectFile`).
- **TriggersSection**: see Task 6.
- **Overview**: recent documents + recent projects + recent chats (adapt the existing `Overview` to two lists).

Delete `RepoDetail`, `FileDetail`, `TemplateItemDetail`, `ItemFilesPanel`, `BlockInserter`, `BLOCK_CATALOG`, `makeBlock`, `itemPreview`, and the `ItemIcon` cases for item types (keep a generic icon).

- [ ] **Step 4: Update `SpacePage.test.tsx`**

Rewrite expectations to the new tabs/sections; remove block/item assertions. Mock the new API fns. Keep at least one render test asserting the Documents tab lists a mocked document.

- [ ] **Step 5: Typecheck + test**

Run: `cd web && npx tsc --noEmit && npx vitest run src/pages/SpacePage.test.tsx`
Expected: clean compile for SpacePage's dependency graph + PASS. (Other files fixed in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/SpacePage.tsx web/src/App.tsx web/src/pages/SpacePage.test.tsx web/src/components/FileBrowser.tsx
git commit -m "feat(web): SpacePage with Documents/Projects/Triggers sections"
```

---

## Task 6: TriggersSection (automation UI)

**Files:**
- Create: `web/src/components/TriggersSection.tsx`
- (Wired into SpacePage in Task 5 Step 3; if done separately, import it there now.)

**Interfaces:**
- Consumes `getTriggers`, `createTrigger`, `deleteTrigger`, `getDocuments` (to pick a playbook). Lists triggers; "Add trigger" dialog: kind=schedule, a cron text input, and a Select of documents with `type === 'workflow'` as playbook.

- [ ] **Step 1: Implement**

```tsx
// web/src/components/TriggersSection.tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTriggers, createTrigger, deleteTrigger, getDocuments } from '../lib/api.js';
import type { Trigger } from '../types.js';

export default function TriggersSection({ spaceId }: { spaceId: string }) {
  const qc = useQueryClient();
  const { data: triggers = [] } = useQuery<Trigger[]>({ queryKey: ['triggers', spaceId], queryFn: () => getTriggers(spaceId) });
  const { data: playbooks = [] } = useQuery({ queryKey: ['documents', spaceId, 'workflow'], queryFn: () => getDocuments(spaceId, { type: 'workflow' }) });
  const [cron, setCron] = useState('0 8 * * *');
  const [playbookId, setPlaybookId] = useState<string>('');

  const create = useMutation({
    mutationFn: () => createTrigger(spaceId, { kind: 'schedule', schedule_cron: cron, playbook_id: playbookId || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers', spaceId] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteTrigger(spaceId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers', spaceId] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input value={cron} onChange={e => setCron(e.target.value)} placeholder="cron (UTC) e.g. 0 8 * * *" className="w-48" />
        <Select value={playbookId} onValueChange={setPlaybookId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Playbook document" /></SelectTrigger>
          <SelectContent>{playbooks.map(p => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>Add trigger</Button>
      </div>
      {triggers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No triggers. A trigger runs a workflow document on a schedule.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {triggers.map(t => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border border-border-soft bg-card px-4 py-3">
              <div className="text-sm">
                <span className="font-mono">{t.schedule_cron ?? t.kind}</span>
                <span className="ml-2 text-xs text-faint-fg">{t.enabled ? 'enabled' : 'disabled'}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(t.id)}>Delete</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/TriggersSection.tsx
git commit -m "feat(web): TriggersSection automation UI"
```

---

## Task 7: Purge remaining item references across web + final gate

**Files:**
- Modify: `web/src/components/ChatView.tsx`, `web/src/components/ContextPanel.tsx`, `web/src/components/MessageList.tsx`, `web/src/pages/SpacesPage.tsx`, `web/src/pages/Settings.tsx` (+ their tests)

- [ ] **Step 1: Fix ChatView WS event handling**

In `ChatView.tsx` (~lines 460–461) replace `item_created|item_updated` and the `['space-items', ...]` invalidation with `document_created|document_updated|project_created` → invalidate `['documents', ev.event.space_id]` / `['projects', ev.event.space_id]`.

- [ ] **Step 2: Fix the rest**

Grep and repoint each remaining reference:

Run: `cd web && grep -rn "SpaceItem\|page_blocks\|BlockRenderer\|getSpaceItems\|listItemTemplates\|ItemTemplate\|\bBlock\b\|space-items\|item_created\|item_updated" src`

For each hit in `ContextPanel.tsx`, `MessageList.tsx`, `SpacesPage.tsx`, `Settings.tsx`: replace item/block usage with the document/project equivalent (e.g. ContextPanel showing space contents → list documents + projects; SpacesPage space cards counting items → count documents+projects). Remove scheduled-task UI in `Settings.tsx` if it used the removed client fns, or repoint to triggers.

- [ ] **Step 3: Final typecheck + full web test + build**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean compile, tests pass, production build succeeds.

- [ ] **Step 4: Confirm no orphans**

Run: `cd web && grep -rn "SpaceItem\|BlockRenderer\|page_blocks\|getSpaceItems\|ItemTemplate" src | grep -v node_modules`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(web): purge item/block references; documents+projects everywhere"
```

---

## Self-Review

- **Spec coverage:** types (Task 1), API client (Task 2), markdown editor replacing blocks (Task 3), tracker views (Task 4), SpacePage sections + routes + projects file browser (Task 5), triggers UI (Task 6), full purge + build gate (Task 7). ✓
- **Placeholder scan:** Task 5 Step 3 describes section composition in prose but each piece names the exact API fn and component to use and what to delete — actionable, not a TBD. New components (DocumentView, TrackerView, TriggersSection) have complete code.
- **Type consistency:** `Document`/`DocumentWithBody`/`Project`/`Trigger` field names match Task 1 ↔ Task 2 signatures ↔ component props. `updateDocument(spaceId, docId, { body })` call in DocumentView matches the Task 2 signature. Query keys `['documents', spaceId]` / `['projects', spaceId]` / `['triggers', spaceId]` are used consistently across SpacePage, ChatView, and TriggersSection.

---

## Done criteria (all three plans)

- Backend: `cd server && npx tsc --noEmit && npx vitest run` green; no references to the item subsystem.
- Web: `cd web && npx tsc --noEmit && npx vitest run && npm run build` green; no references to blocks/items.
- Manual smoke (the two validating spaces): create an "Internship Search" space → add a `type:workflow` playbook document → create a daily trigger on it → confirm a pinned chat is seeded on fire; create a "Yuzic" space → create/link a project → browse its files. Both work with the same primitives.
