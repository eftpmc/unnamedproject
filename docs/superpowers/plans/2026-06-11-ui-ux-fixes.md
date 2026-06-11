# UI/UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 UI/UX issues found in Playwright review: markdown rendering, scroll-to-latest, projects panel routing, new session empty state, auto session naming, delete confirmations, and minor copy fixes.

**Architecture:** Server changes are minimal route/service patches. Frontend changes touch MessageList, SessionView, AppLayout, Settings, and two new components (ProjectsEmptyState, ConfirmDialog).

**Tech Stack:** React 19, TypeScript, Tailwind v4, shadcn/ui (Dialog), react-markdown, Express, Anthropic SDK, Vitest + supertest

---

## File Map

**Create:**
- `web/src/components/ProjectsEmptyState.tsx` — empty state for projects panel in main area
- `web/src/components/ui/confirm-dialog.tsx` — reusable confirmation dialog wrapping shadcn Dialog

**Modify:**
- `server/src/routes/sessions.ts` — accept `title` in PATCH body
- `server/src/services/agent.ts` — auto-generate title after first assistant turn
- `server/tests/sessions.test.ts` — add test for PATCH title
- `web/src/types.ts` — add `WSSessionTitleUpdated` event type
- `web/src/components/MessageList.tsx` — markdown rendering + scroll fix
- `web/src/components/SessionView.tsx` — new session hint, remove subtitle, handle title WS event
- `web/src/pages/AppLayout.tsx` — render ProjectsEmptyState when projects panel active
- `web/src/pages/Settings.tsx` — ConfirmDialog for deletes + MCP card copy

---

## Task 1: Server — Accept title in PATCH /sessions/:id

**Files:**
- Modify: `server/src/routes/sessions.ts`
- Modify: `server/tests/sessions.test.ts`

- [ ] **Step 1: Write failing test**

Add to the `describe('sessions')` block in `server/tests/sessions.test.ts` after the existing tests:

```ts
it('updates session title', async () => {
  const res = await request(app)
    .patch(`/sessions/${sessionId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Fix the login bug' });
  expect(res.status).toBe(200);

  const list = await request(app)
    .get('/sessions')
    .set('Authorization', `Bearer ${token}`);
  expect(list.body[0].title).toBe('Fix the login bug');
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd server && npx vitest run tests/sessions.test.ts 2>&1 | tail -20
```

Expected: fails because PATCH ignores `title`.

- [ ] **Step 3: Update PATCH handler to accept title**

In `server/src/routes/sessions.ts`, replace the `router.patch('/:id', ...)` handler:

```ts
router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { effort, model, title } = req.body as { effort?: string; model?: string | null; title?: string };

  if (effort === undefined && model === undefined && title === undefined) {
    res.status(400).json({ error: 'effort, model, or title required' });
    return;
  }
  if (effort !== undefined && !isEffortLevel(effort)) {
    res.status(400).json({ error: 'effort must be one of: low, medium, high' });
    return;
  }
  if (model !== undefined && model !== null && typeof model !== 'string') {
    res.status(400).json({ error: 'model must be a string or null' });
    return;
  }

  const session = getDb().prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  if (effort !== undefined) {
    getDb().prepare('UPDATE sessions SET effort = ? WHERE id = ?').run(effort, req.params.id);
  }
  if (model !== undefined) {
    getDb().prepare('UPDATE sessions SET model = ? WHERE id = ?').run(model, req.params.id);
  }
  if (title !== undefined) {
    getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, req.params.id);
  }
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npx vitest run tests/sessions.test.ts 2>&1 | tail -20
```

Expected: all sessions tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/sessions.ts server/tests/sessions.test.ts
git commit -m "feat: accept title in PATCH /sessions/:id"
```

---

## Task 2: Server — Auto-generate session title after first turn

**Files:**
- Modify: `server/src/services/agent.ts`

- [ ] **Step 1: Add the title generation function**

In `server/src/services/agent.ts`, add this function after the imports (around line 20, after `broadcast` import):

```ts
async function maybeGenerateSessionTitle(userId: string, sessionId: string): Promise<void> {
  // Only generate if session has no title yet
  const session = getDb()
    .prepare('SELECT title FROM sessions WHERE id = ?')
    .get(sessionId) as { title: string | null } | undefined;
  if (!session || session.title) return;

  // Get the first user message
  const firstUser = getDb()
    .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at LIMIT 1")
    .get(sessionId) as { content: string } | undefined;
  if (!firstUser) return;

  let apiKey: string;
  try {
    apiKey = getAnthropicKey(userId);
  } catch {
    return; // no key configured, skip silently
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Write a short title (4-6 words) for a conversation that starts with this message. Reply with only the title, no quotes or punctuation:\n\n${firstUser.content.slice(0, 500)}`,
      }],
    });
    const title = response.content[0].type === 'text' ? response.content[0].text.trim() : null;
    if (!title) return;

    getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId);
    broadcast(userId, { type: 'session_title_updated', sessionId, title });
  } catch {
    // title generation is best-effort, never throw
  }
}
```

- [ ] **Step 2: Call maybeGenerateSessionTitle at end of runAgentTurn**

At the very end of `runAgentTurn` (currently ends with `broadcast(userId, { type: 'turn_complete', sessionId })`), add the non-blocking call:

```ts
  broadcast(userId, { type: 'turn_complete', sessionId });

  // Fire-and-forget: generate title after first turn
  maybeGenerateSessionTitle(userId, sessionId).catch(() => {});
}
```

- [ ] **Step 3: Run server tests to confirm no regressions**

```bash
cd server && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass (title generation won't fire in tests since no Anthropic key is set).

- [ ] **Step 4: Commit**

```bash
git add server/src/services/agent.ts
git commit -m "feat: auto-generate session title after first agent turn"
```

---

## Task 3: Frontend — Add WSSessionTitleUpdated type

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Add the type**

In `web/src/types.ts`, after the `WSMessageDelta` interface, add:

```ts
export interface WSSessionTitleUpdated extends WSEvent {
  type: 'session_title_updated';
  sessionId: string;
  title: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/types.ts
git commit -m "feat: add WSSessionTitleUpdated event type"
```

---

## Task 4: Frontend — ConfirmDialog component

**Files:**
- Create: `web/src/components/ui/confirm-dialog.tsx`

- [ ] **Step 1: Create the component**

Create `web/src/components/ui/confirm-dialog.tsx`:

```tsx
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, description, confirmLabel = 'Delete', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ui/confirm-dialog.tsx
git commit -m "feat: add ConfirmDialog component"
```

---

## Task 5: Frontend — Settings delete confirmations + MCP hint

**Files:**
- Modify: `web/src/pages/Settings.tsx`

- [ ] **Step 1: Add ConfirmDialog import and pendingDelete state**

At the top of `Settings.tsx`, add the import after the existing Dialog import line:

```ts
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
```

Inside `export default function Settings()`, add this state after the existing state declarations (around line 143):

```ts
const [pendingDelete, setPendingDelete] = useState<{ kind: 'connection' | 'project'; id: string } | null>(null);
```

- [ ] **Step 2: Update DeleteBtn usages to go through pendingDelete**

Replace the `DeleteBtn` component definition (around line 101) with an identical one (no change needed — it already just calls `onClick`). The change is at the *call sites*.

In the `SetupCard` component (around line 297), change:
```tsx
{connection && <DeleteBtn onClick={() => deleteConnMutation.mutate(connection.id)} />}
```
to:
```tsx
{connection && <DeleteBtn onClick={() => setPendingDelete({ kind: 'connection', id: connection.id })} />}
```

In the `SetupModal` component (around line 317), change:
```tsx
<DeleteBtn onClick={() => deleteConnMutation.mutate(existing.id)} />
```
to:
```tsx
<DeleteBtn onClick={() => setPendingDelete({ kind: 'connection', id: existing.id })} />
```

In the Projects section (around line 498), change:
```tsx
<DeleteBtn onClick={() => deleteProjMutation.mutate(p.id)} />
```
to:
```tsx
<DeleteBtn onClick={() => setPendingDelete({ kind: 'project', id: p.id })} />
```

- [ ] **Step 3: Render ConfirmDialog and handle confirmation**

In the `return (...)` block of `Settings`, just before `<SetupModal />` (around line 578), add:

```tsx
{pendingDelete && (
  <ConfirmDialog
    title={pendingDelete.kind === 'connection' ? 'Remove connection?' : 'Delete project?'}
    description={
      pendingDelete.kind === 'connection'
        ? 'This will disconnect the integration. You can reconnect it at any time.'
        : 'This will permanently delete the project and its configuration.'
    }
    confirmLabel="Delete"
    onConfirm={() => {
      if (pendingDelete.kind === 'connection') deleteConnMutation.mutate(pendingDelete.id);
      else deleteProjMutation.mutate(pendingDelete.id);
      setPendingDelete(null);
    }}
    onCancel={() => setPendingDelete(null)}
  />
)}
```

- [ ] **Step 4: Update MCP card description**

Find the "Add MCP Server" card `CardDescription` (around line 447) and change it from:
```tsx
<CardDescription>Expose extra tools to workspaces.</CardDescription>
```
to:
```tsx
<CardDescription>Run an MCP server process (command + args) to expose extra tools.</CardDescription>
```

- [ ] **Step 5: Verify the app compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Settings.tsx
git commit -m "feat: add delete confirmation dialogs and update MCP hint text"
```

---

## Task 6: Frontend — ProjectsEmptyState + AppLayout routing

**Files:**
- Create: `web/src/components/ProjectsEmptyState.tsx`
- Modify: `web/src/pages/AppLayout.tsx`

- [ ] **Step 1: Create ProjectsEmptyState component**

Create `web/src/components/ProjectsEmptyState.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ProjectsEmptyState() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <Card className="w-full max-w-md rounded-3xl border-border/60 bg-background/72 text-center shadow-sm">
        <CardHeader>
          <CardTitle>Your projects</CardTitle>
          <CardDescription>Set up a project in Settings to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate('/settings')}>Go to Settings</Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Update AppLayout to use ProjectsEmptyState when projects panel is active**

In `web/src/pages/AppLayout.tsx`, add the import at the top:

```ts
import ProjectsEmptyState from '../components/ProjectsEmptyState.js';
```

Replace the `mainContent` assignment (currently around line 39):

```ts
const mainContent = isSettings
  ? <Outlet />
  : activePanel === 'projects'
    ? <ProjectsEmptyState />
    : sessionId
      ? <SessionView sessionId={sessionId} />
      : <EmptyState onNewSession={handleNewSession} />;
```

- [ ] **Step 3: Verify compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ProjectsEmptyState.tsx web/src/pages/AppLayout.tsx
git commit -m "feat: show ProjectsEmptyState in main area when projects panel is active"
```

---

## Task 7: Frontend — Markdown rendering + scroll fix in MessageList

**Files:**
- Modify: `web/src/components/MessageList.tsx`

- [ ] **Step 1: Install react-markdown**

```bash
cd web && npm install react-markdown
```

Expected: react-markdown added to node_modules and package-lock.json updated.

- [ ] **Step 2: Rewrite MessageList.tsx**

Replace the entire file `web/src/components/MessageList.tsx` with:

```tsx
import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import ExecutionCard from './ExecutionCard.js';
import type { Message } from '../types.js';
import { Card, CardContent } from '@/components/ui/card';

interface InlineExecution {
  executionId: string;
  tool: string;
  projectName?: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval';
  outputLog: string;
  result: string | null;
  needsApproval: boolean;
  approvalId: string | null;
  action: string | null;
}

interface MessageListProps {
  messages: Message[];
  executions: Record<string, InlineExecution[]>;
  streamingIds?: Set<string>;
}

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children, className }) => {
    const isBlock = !!className;
    if (isBlock) return <code className="block">{children}</code>;
    return <code className="rounded bg-muted px-1 font-mono text-[13px]">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-[13px] leading-relaxed font-mono">{children}</pre>
  ),
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
};

export default function MessageList({ messages, executions, streamingIds }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({
      behavior: initialScrollDone.current ? 'smooth' : 'instant',
    });
    initialScrollDone.current = true;
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-6">
        {messages.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <Card className="max-w-[72%] rounded-3xl rounded-br-lg border-transparent bg-foreground py-0 text-background shadow-sm">
                  <CardContent className="px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="flex w-fit max-w-[86%] flex-col gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-success" />
                  Assistant
                </div>
                <div className="rounded-3xl rounded-bl-lg bg-background/72 px-4 py-3 text-[15px] leading-7 text-foreground shadow-xs ring-1 ring-border/45">
                  <ReactMarkdown components={markdownComponents}>
                    {msg.content}
                  </ReactMarkdown>
                  {streamingIds?.has(msg.id) && (
                    <span className="ml-1 inline-block h-4 w-1.5 animate-pulse align-middle rounded-full bg-foreground/40" />
                  )}
                </div>
                {(executions[msg.id] ?? []).map(exec => (
                  <ExecutionCard key={exec.executionId} {...exec} />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/MessageList.tsx web/package.json web/package-lock.json
git commit -m "feat: render markdown in assistant messages, fix scroll-to-latest on load"
```

---

## Task 8: Frontend — SessionView: new session hint, remove subtitle, title WS handler

**Files:**
- Modify: `web/src/components/SessionView.tsx`

- [ ] **Step 1: Add WSSessionTitleUpdated import**

In `web/src/components/SessionView.tsx`, update the types import line to include `WSSessionTitleUpdated`:

```ts
import type { EffortLevel, Message, Session, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved, WSSessionTitleUpdated } from '../types.js';
```

- [ ] **Step 2: Handle session_title_updated WS event**

In `handleWsEvent`, after the `action_auto_approved` block (around line 156), add:

```ts
    if (event.type === 'session_title_updated') {
      const ev = event as WSSessionTitleUpdated;
      if (ev.sessionId === sessionId) {
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      }
    }
```

- [ ] **Step 3: Remove the "Agent session" subtitle**

In the `return (...)` block, find the header section (around line 200):

```tsx
<header className="flex h-16 shrink-0 items-center gap-3 px-6">
  <div className="min-w-0 flex-1">
    <div className="truncate text-sm font-medium">{sessionTitle}</div>
    <div className="text-xs text-muted-foreground">Agent session</div>
  </div>
</header>
```

Remove the subtitle line, leaving:

```tsx
<header className="flex h-16 shrink-0 items-center gap-3 px-6">
  <div className="min-w-0 flex-1">
    <div className="truncate text-sm font-medium">{sessionTitle}</div>
  </div>
</header>
```

- [ ] **Step 4: Add empty session hint**

In the `return (...)` block, replace:

```tsx
<MessageList messages={messages} executions={executions} streamingIds={streamingIds} />
```

with:

```tsx
{messages.length === 0 ? (
  <div className="flex flex-1 items-center justify-center">
    <p className="text-sm text-muted-foreground/60">Send a message to get started</p>
  </div>
) : (
  <MessageList messages={messages} executions={executions} streamingIds={streamingIds} />
)}
```

- [ ] **Step 5: Verify compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Run all server tests to confirm no regressions**

```bash
cd server && npx vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/SessionView.tsx
git commit -m "feat: new session hint, remove Agent session subtitle, handle title WS event"
```
