# Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-panel nav (icon rail + sliding nav panel) with a single sidebar, rename sessions→chats throughout the UI, add `read_chat` agent tool and recent chat context to the system prompt, and add Chats/Projects as full pages.

**Architecture:** `AppLayout` becomes a simple sidebar + `<Outlet>` shell. `Sidebar` replaces `IconRail` + `NavPanel`. New pages `ChatsPage` and `ProjectsPage` live at `/chats` and `/projects`. `SessionView` is renamed `ChatView` and reached at `/c/:chatId`. Server gets three additions: `GET /auth/me`, `DELETE /sessions/:id`, and `read_chat` agent tool.

**Tech Stack:** React + react-router-dom v6, TanStack Query, shadcn/ui (DropdownMenu to be installed), Vitest, Supertest, SQLite/better-sqlite3.

---

## File map

**Create:**
- `web/src/components/UserMenu.tsx` — shadcn DropdownMenu trigger at bottom of sidebar
- `web/src/components/Sidebar.tsx` — single sidebar replacing IconRail + NavPanel
- `web/src/pages/ChatsPage.tsx` — full chat list page
- `web/src/pages/ProjectsPage.tsx` — full projects list page
- `server/src/tools/read_chat.ts` — read_chat tool logic (extracted for testability)
- `server/tests/tools/read_chat.test.ts`

**Modify:**
- `server/src/routes/auth.ts` — add GET /auth/me
- `server/src/routes/sessions.ts` — add DELETE /sessions/:id
- `server/src/tools/definitions.ts` — add read_chat tool definition
- `server/src/services/agent.ts` — wire read_chat dispatch + recent chats in system prompt
- `server/tests/auth.test.ts` — cover /auth/me
- `server/tests/sessions.test.ts` — cover DELETE
- `web/src/lib/api.ts` — rename getSessions→getChats, createSession→createChat, add getMe(), deleteChat()
- `web/src/lib/utils.ts` — add timeAgo helper
- `web/src/lib/api.test.ts` — update renamed functions
- `web/src/App.tsx` — new route tree
- `web/src/pages/AppLayout.tsx` — sidebar + Outlet only
- `web/src/components/SessionView.tsx` — rename to ChatView.tsx, update text
- `web/src/components/EmptyState.tsx` — update text

**Delete:**
- `web/src/components/IconRail.tsx`
- `web/src/components/NavPanel.tsx`
- `web/src/components/ProjectsEmptyState.tsx`

---

## Task 1: Server — GET /auth/me + DELETE /sessions/:id

**Files:**
- Modify: `server/src/routes/auth.ts`
- Modify: `server/src/routes/sessions.ts`
- Modify: `server/tests/auth.test.ts`
- Modify: `server/tests/sessions.test.ts`

- [ ] **Step 1: Add /auth/me test**

In `server/tests/auth.test.ts`, add inside the `describe('auth')` block (or after existing tests):

```typescript
it('GET /auth/me returns current user email', async () => {
  const res = await request(app)
    .get('/auth/me')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.email).toMatch(/@test\.com$/);
});

it('GET /auth/me returns 401 without token', async () => {
  const res = await request(app).get('/auth/me');
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd server && npx vitest run tests/auth.test.ts
```
Expected: FAIL — `GET /auth/me` returns 404 (route not found)

- [ ] **Step 3: Implement GET /auth/me in auth.ts**

Add the import and route before `export default router`:

```typescript
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

router.get('/me', requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  const user = getDb()
    .prepare('SELECT email FROM users WHERE id = ?')
    .get(userId) as { email: string } | undefined;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ email: user.email });
});
```

- [ ] **Step 4: Add DELETE /sessions/:id test**

In `server/tests/sessions.test.ts`, add:

```typescript
it('DELETE /sessions/:id deletes the session', async () => {
  const create = await request(app)
    .post('/sessions')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const id = create.body.id;

  const del = await request(app)
    .delete(`/sessions/${id}`)
    .set('Authorization', `Bearer ${token}`);
  expect(del.status).toBe(200);
  expect(del.body.ok).toBe(true);

  const list = await request(app)
    .get('/sessions')
    .set('Authorization', `Bearer ${token}`);
  expect(list.body.find((s: { id: string }) => s.id === id)).toBeUndefined();
});

it('DELETE /sessions/:id returns 404 for another user', async () => {
  const create = await request(app)
    .post('/sessions')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const id = create.body.id;

  const other = await request(app)
    .post('/auth/register')
    .send({ email: `other-del-${Date.now()}@test.com`, password: 'pass' });
  const otherToken = other.body.token;

  const del = await request(app)
    .delete(`/sessions/${id}`)
    .set('Authorization', `Bearer ${otherToken}`);
  expect(del.status).toBe(404);
});
```

- [ ] **Step 5: Implement DELETE /sessions/:id in sessions.ts**

Add before `export default router`:

```typescript
router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd server && npx vitest run tests/auth.test.ts tests/sessions.test.ts
```
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/auth.ts server/src/routes/sessions.ts server/tests/auth.test.ts server/tests/sessions.test.ts
git commit -m "feat: add GET /auth/me and DELETE /sessions/:id"
```

---

## Task 2: Server — read_chat tool

**Files:**
- Create: `server/src/tools/read_chat.ts`
- Create: `server/tests/tools/read_chat.test.ts`
- Modify: `server/src/tools/definitions.ts`
- Modify: `server/src/services/agent.ts`

- [ ] **Step 1: Write the failing test**

Create `server/tests/tools/read_chat.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { readChat } from '../../src/tools/read_chat.js';
import { newId } from '../../src/lib/ids.js';

const userId = newId();
const otherUserId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `read-chat-${userId}@test.com`, 'x');
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(otherUserId, `read-chat-other-${userId}@test.com`, 'x');

  sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(sessionId, userId, 'My test chat');
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(newId(), sessionId, 'user', 'Hello there');
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(newId(), sessionId, 'assistant', 'Hi! How can I help?');
});

describe('readChat', () => {
  it('returns formatted messages for a valid chat', () => {
    const result = readChat(userId, sessionId);
    expect(result).toContain('My test chat');
    expect(result).toContain('[user]: Hello there');
    expect(result).toContain('[assistant]: Hi! How can I help?');
  });

  it('returns error for chat owned by another user', () => {
    const result = readChat(otherUserId, sessionId);
    expect(result).toContain('not found');
  });

  it('returns error for non-existent chat', () => {
    const result = readChat(userId, 'fake-id');
    expect(result).toContain('not found');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd server && npx vitest run tests/tools/read_chat.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement read_chat.ts**

Create `server/src/tools/read_chat.ts`:

```typescript
import { getDb } from '../db/index.js';

export function readChat(userId: string, chatId: string): string {
  const session = getDb()
    .prepare('SELECT id, title FROM sessions WHERE id = ? AND user_id = ?')
    .get(chatId, userId) as { id: string; title: string | null } | undefined;

  if (!session) return `Chat ${chatId} not found`;

  const msgs = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 100')
    .all(chatId) as { role: string; content: string }[];

  if (msgs.length === 0) return `Chat "${session.title ?? 'Untitled'}" has no messages.`;

  const body = msgs.map(m => `[${m.role}]: ${m.content.slice(0, 1000)}`).join('\n\n');
  return `Chat: "${session.title ?? 'Untitled'}"\n\n${body}`;
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd server && npx vitest run tests/tools/read_chat.test.ts
```
Expected: all PASS

- [ ] **Step 5: Add read_chat to tool definitions**

In `server/src/tools/definitions.ts`, add before the closing `]`:

```typescript
{
  name: 'read_chat',
  description: 'Retrieve messages from a previous chat. Use when the user references past work, asks to continue something, or you need context before responding.',
  input_schema: {
    type: 'object',
    properties: {
      chat_id: { type: 'string', description: 'ID of the chat to read — get IDs from the recent chats list in your context' },
    },
    required: ['chat_id'],
  },
},
```

- [ ] **Step 6: Wire read_chat in agent.ts dispatch**

In `server/src/services/agent.ts`, add import at top:

```typescript
import { readChat } from '../tools/read_chat.js';
```

Add case in `dispatchTool` switch, after the `'forget'` case:

```typescript
case 'read_chat':
  result = readChat(userId, toolInput.chat_id as string);
  break;
```

- [ ] **Step 7: Commit**

```bash
git add server/src/tools/read_chat.ts server/tests/tools/read_chat.test.ts server/src/tools/definitions.ts server/src/services/agent.ts
git commit -m "feat: add read_chat agent tool"
```

---

## Task 3: Server — recent chats in system prompt

**Files:**
- Modify: `server/src/services/agent.ts`
- Modify: `server/tests/services/agent.test.ts`

- [ ] **Step 1: Write the failing test**

In `server/tests/services/agent.test.ts`, add a new `it` block inside `describe('runAgentTurn')` (after the existing test setup and test):

```typescript
it('includes recent chat titles in the system prompt', async () => {
  const db = getDb();
  const recentId = newId();
  db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(recentId, userId, 'My recent chat');

  streamMock.mockClear();
  const msgId2 = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId2, sessionId, 'user', 'test recent chats');
  await runAgentTurn(userId, sessionId, msgId2);

  const callArgs = streamMock.mock.calls[0][0] as { system: string };
  expect(callArgs.system).toContain('My recent chat');
  expect(callArgs.system).toContain(recentId);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd server && npx vitest run tests/services/agent.test.ts
```
Expected: FAIL — system prompt does not contain chat titles

- [ ] **Step 3: Add recent chats to buildSystemPrompt in agent.ts**

Add helper functions before `buildSystemPrompt`:

```typescript
function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getRecentChats(userId: string): Array<{ id: string; title: string | null; updated_at: number }> {
  return getDb()
    .prepare('SELECT id, title, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10')
    .all(userId) as Array<{ id: string; title: string | null; updated_at: number }>;
}
```

In `buildSystemPrompt`, add after `const projectsText = ...`:

```typescript
const recentChats = getRecentChats(userId);
const recentChatsText = recentChats.length > 0
  ? `\n\nRecent chats (use read_chat to retrieve full context when relevant):\n${recentChats.map(c => `- "${c.title ?? 'Untitled'}" (id: ${c.id}, ${timeAgo(c.updated_at)})`).join('\n')}`
  : '';
```

And add `${recentChatsText}` to the returned template string after `${projectsText}`.

- [ ] **Step 4: Run tests**

```bash
cd server && npx vitest run tests/services/agent.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent.ts server/tests/services/agent.test.ts
git commit -m "feat: inject recent chat titles into agent system prompt"
```

---

## Task 4: Frontend — install dropdown-menu, add timeAgo to utils, update api.ts

**Files:**
- Modify: `web/src/lib/utils.ts`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/lib/api.test.ts`

- [ ] **Step 1: Install shadcn dropdown-menu**

```bash
cd web && npx shadcn@latest add dropdown-menu
```
Expected: creates `web/src/components/ui/dropdown-menu.tsx`

- [ ] **Step 2: Add timeAgo to utils.ts**

In `web/src/lib/utils.ts`, append:

```typescript
export function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}
```

- [ ] **Step 3: Update api.ts — rename + add getMe/deleteChat**

Replace the sessions section in `web/src/lib/api.ts` with:

```typescript
export function getChats(): Promise<Session[]> {
  return request('/sessions');
}

export function createChat(title?: string): Promise<{ id: string }> {
  return request('/sessions', { method: 'POST', body: JSON.stringify({ title }) });
}

export function deleteChat(id: string): Promise<void> {
  return request(`/sessions/${id}`, { method: 'DELETE' });
}

export function updateChatConfig(chatId: string, config: { effort?: EffortLevel; model?: string | null }): Promise<void> {
  return request(`/sessions/${chatId}`, { method: 'PATCH', body: JSON.stringify(config) });
}

export function getModelsForEffort(effort: EffortLevel): Promise<ClaudeModelInfo[]> {
  return request(`/sessions/models?effort=${effort}`);
}

export function getMessages(chatId: string): Promise<Message[]> {
  return request(`/sessions/${chatId}/messages`);
}

export function sendMessage(chatId: string, content: string): Promise<Message> {
  return request(`/sessions/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function getMe(): Promise<{ email: string }> {
  return request('/auth/me');
}
```

Remove `updateSessionConfig` and the old `getSessions`/`createSession` declarations (they are replaced above).

- [ ] **Step 4: Update api.test.ts**

In `web/src/lib/api.test.ts`, update the import and the `getSessions` test:

```typescript
const { login, getChats, createChat } = await import('./api');

// inside describe:
it('getChats includes auth header', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
  await getChats();
  const [, opts] = mockFetch.mock.calls[0];
  expect(opts.headers.Authorization).toBe('Bearer test-token');
});
```

- [ ] **Step 5: Run web tests**

```bash
cd web && npx vitest run src/lib/api.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ui/dropdown-menu.tsx web/src/lib/utils.ts web/src/lib/api.ts web/src/lib/api.test.ts
git commit -m "feat: install dropdown-menu, add timeAgo util, rename session api to chat"
```

---

## Task 5: Frontend — UserMenu component

**Files:**
- Create: `web/src/components/UserMenu.tsx`

- [ ] **Step 1: Create UserMenu.tsx**

```typescript
import { useNavigate } from 'react-router-dom';
import { Moon, Sun, Settings } from 'lucide-react';
import { useTheme } from '../lib/useTheme.js';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../lib/api.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function UserMenu() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe, staleTime: Infinity });

  const initial = me?.email?.[0]?.toUpperCase() ?? 'U';
  const label = me?.email?.split('@')[0] ?? '…';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-background/60 focus-visible:outline-none">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-xs font-semibold text-background">
            {initial}
          </div>
          <span className="flex-1 truncate text-sm font-medium">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-48">
        <DropdownMenuItem onClick={toggleTheme}>
          {theme === 'unnamed-dark'
            ? <Moon size={14} className="mr-2" />
            : <Sun size={14} className="mr-2" />}
          {theme === 'unnamed-dark' ? 'Dark mode' : 'Light mode'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/settings')}>
          <Settings size={14} className="mr-2" />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/components/UserMenu.tsx
git commit -m "feat: add UserMenu component with theme toggle and settings"
```

---

## Task 6: Frontend — Sidebar component

**Files:**
- Create: `web/src/components/Sidebar.tsx`

- [ ] **Step 1: Create Sidebar.tsx**

```typescript
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MessagesSquare, LayoutGrid } from 'lucide-react';
import { getChats, createChat } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { cn } from '../lib/utils.js';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import UserMenu from './UserMenu.js';
import type { Session } from '../types.js';

const RECENT_COUNT = 5;

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  async function handleNewChat() {
    const { id } = await createChat();
    await queryClient.invalidateQueries({ queryKey: ['chats'] });
    navigate(`/c/${id}`);
  }

  const activeChatId = location.pathname.startsWith('/c/')
    ? location.pathname.slice(3)
    : null;

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const recentChats = chats.slice(0, RECENT_COUNT);

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-hidden rounded-3xl bg-background/50 py-3 backdrop-blur">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background shadow-sm">
          u
        </div>
        <span className="text-sm font-semibold">unnamed</span>
      </div>

      {/* New chat */}
      <div className="px-3 pb-2">
        <button
          onClick={handleNewChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <Plus size={14} strokeWidth={2} />
          New chat
        </button>
      </div>

      <Separator className="mx-3 w-auto bg-border/50" />

      {/* Nav links */}
      <div className="px-2 py-2">
        <NavItem
          icon={<MessagesSquare size={15} strokeWidth={1.75} />}
          label="Chats"
          active={isActive('/chats')}
          onClick={() => navigate('/chats')}
        />
        <NavItem
          icon={<LayoutGrid size={15} strokeWidth={1.75} />}
          label="Projects"
          active={isActive('/projects')}
          onClick={() => navigate('/projects')}
        />
      </div>

      <div className="flex-1" />

      {/* Recent chats */}
      {recentChats.length > 0 && (
        <>
          <Separator className="mx-3 w-auto bg-border/50" />
          <div className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">Recent</div>
          <ScrollArea className="max-h-52">
            <div className="px-2 pb-2">
              {recentChats.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => navigate(`/c/${chat.id}`)}
                  className={cn(
                    'mb-0.5 w-full rounded-xl px-3 py-2 text-left transition-colors',
                    activeChatId === chat.id
                      ? 'bg-background text-foreground shadow-xs ring-1 ring-border/50'
                      : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
                  )}
                >
                  <div className="truncate text-xs font-medium">{chat.title ?? 'Untitled chat'}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{timeAgo(chat.updated_at)}</div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </>
      )}

      {/* User menu */}
      <Separator className="mx-3 w-auto bg-border/50" />
      <div className="px-2 pt-2">
        <UserMenu />
      </div>
    </aside>
  );
}

function NavItem({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-xs ring-1 ring-border/50'
          : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Sidebar.tsx
git commit -m "feat: add Sidebar component"
```

---

## Task 7: Frontend — ChatsPage

**Files:**
- Create: `web/src/pages/ChatsPage.tsx`

- [ ] **Step 1: Create ChatsPage.tsx**

```typescript
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { getChats, deleteChat } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Session } from '../types.js';

export default function ChatsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: chats = [], isLoading } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteChat,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
  });

  if (isLoading) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center px-6">
        <h1 className="text-sm font-medium">Chats</h1>
      </header>

      {chats.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground/60">No chats yet. Start a new one.</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-6 pb-6">
            <div className="divide-y divide-border/50 rounded-2xl border border-border/50 bg-background/40">
              {chats.map(chat => (
                <div key={chat.id} className="flex items-center gap-3 px-4 py-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => navigate(`/c/${chat.id}`)}
                  >
                    <div className="truncate text-sm font-medium">{chat.title ?? 'Untitled chat'}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{timeAgo(chat.updated_at)}</div>
                  </button>
                  <ConfirmDialog
                    title="Delete chat?"
                    description="This will permanently delete the chat and all its messages."
                    onConfirm={() => deleteMutation.mutate(chat.id)}
                  >
                    <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground hover:text-destructive">
                      <Trash2 size={14} />
                    </Button>
                  </ConfirmDialog>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ChatsPage.tsx
git commit -m "feat: add ChatsPage"
```

---

## Task 8: Frontend — ProjectsPage

**Files:**
- Create: `web/src/pages/ProjectsPage.tsx`

- [ ] **Step 1: Create ProjectsPage.tsx**

```typescript
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getProjects } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Project } from '../types.js';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

  if (isLoading) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between px-6">
        <h1 className="text-sm font-medium">Projects</h1>
        <Button size="sm" variant="outline" onClick={() => navigate('/settings')}>
          Manage in Settings
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground/60">No projects yet.</p>
            <Button className="mt-3" size="sm" onClick={() => navigate('/settings')}>
              Go to Settings
            </Button>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-6 pb-6">
            <div className="divide-y divide-border/50 rounded-2xl border border-border/50 bg-background/40">
              {projects.map((project: Project) => (
                <div key={project.id} className="px-4 py-3">
                  <div className="text-sm font-medium">{project.name}</div>
                  {project.description && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{project.description}</div>
                  )}
                  {project.repo_path && (
                    <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground/60">{project.repo_path}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ProjectsPage.tsx
git commit -m "feat: add ProjectsPage"
```

---

## Task 9: Frontend — Rename SessionView → ChatView, update text

**Files:**
- Create: `web/src/components/ChatView.tsx` (copy of SessionView with renames)
- Delete: `web/src/components/SessionView.tsx` (after wiring ChatView in AppLayout)

- [ ] **Step 1: Create ChatView.tsx**

Copy `web/src/components/SessionView.tsx` to `web/src/components/ChatView.tsx`, then apply these changes:

1. Rename the component: `export default function ChatView({ chatId }: { chatId: string })`
2. Replace all `sessionId` references with `chatId` inside the file (prop name + variable)
3. Replace `updateSessionConfig` import with `updateChatConfig`
4. Replace `getSessions` import with `getChats`
5. Update query keys: `['sessions']` → `['chats']`
6. Update `queryKey: ['messages', sessionId]` → `queryKey: ['messages', chatId]` (keep `getMessages`/`sendMessage` calls using `chatId` as the argument — the API function signatures don't change, they already accept a string id)
7. Change `const sessionTitle = session?.title ?? ...` to `const chatTitle = chat?.title ?? ...`
8. Update the header: `<div className="truncate text-sm font-medium">{chatTitle}</div>`
9. In `session_title_updated` WS handler: `if (ev.sessionId === chatId)`
10. Change `const session = sessions.find(s => s.id === sessionId)` → `const chat = chats.find(c => c.id === chatId)` and update all uses of `session` (effort, model) to use `chat`

The complete updated file:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import { getMessages, sendMessage, getChats, updateChatConfig, getModelsForEffort } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import type { EffortLevel, Message, Session, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved, WSSessionTitleUpdated } from '../types.js';
import { Skeleton } from '@/components/ui/skeleton';

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

export default function ChatView({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['messages', chatId],
    queryFn: () => getMessages(chatId),
  });

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });
  const chat = chats.find(c => c.id === chatId);
  const effort = chat?.effort ?? 'medium';

  const { data: models = [] } = useQuery({
    queryKey: ['models', effort],
    queryFn: () => getModelsForEffort(effort),
  });

  const configMutation = useMutation({
    mutationFn: (config: { effort?: EffortLevel; model?: string | null }) => updateChatConfig(chatId, config),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
  });

  const [executions, setExecutions] = useState<Record<string, InlineExecution[]>>({});
  const [execToMsg, setExecToMsg] = useState<Record<string, string>>({});
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  const mutation = useMutation({
    mutationFn: (content: string) => sendMessage(chatId, content),
    onMutate: () => setSending(true),
    onSettled: () => setSending(false),
    onSuccess: (newMsg) => {
      queryClient.setQueryData<Message[]>(['messages', chatId], prev =>
        prev ? [...prev, newMsg] : [newMsg]
      );
    },
  });

  const handleWsEvent = useCallback((event: WSEvent) => {
    if (event.type === 'agent_error') setSending(false);

    if (event.type === 'message_started') {
      const { message } = event as WSMessageStarted;
      queryClient.setQueryData<Message[]>(['messages', chatId], prev => {
        if (!prev) return [message];
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
      setStreamingIds(prev => new Set(prev).add(message.id));
      setSending(false);
    }

    if (event.type === 'message_delta') {
      const ev = event as WSMessageDelta;
      queryClient.setQueryData<Message[]>(['messages', chatId], prev =>
        prev?.map(m => m.id === ev.messageId ? { ...m, content: m.content + ev.delta } : m)
      );
    }

    if (event.type === 'message_created') {
      const { message } = event as WSMessageCreated;
      queryClient.setQueryData<Message[]>(['messages', chatId], prev => {
        if (!prev) return [message];
        if (prev.some(m => m.id === message.id)) return prev.map(m => m.id === message.id ? message : m);
        return [...prev, message];
      });
      setStreamingIds(prev => {
        if (!prev.has(message.id)) return prev;
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
      setSending(false);
    }

    if (event.type === 'execution_update') {
      const ev = event as WSExecutionUpdate;
      setExecutions(prev => {
        const msgId = execToMsg[ev.executionId];
        if (!msgId) return prev;
        const list = prev[msgId] ?? [];
        const existing = list.find(e => e.executionId === ev.executionId);
        if (!existing) return prev;
        const updated = {
          ...existing,
          ...(ev.status ? { status: ev.status as InlineExecution['status'] } : {}),
          ...(ev.chunk ? { outputLog: existing.outputLog + ev.chunk } : {}),
          ...(ev.result ? { result: ev.result } : {}),
        };
        return { ...prev, [msgId]: list.map(e => e.executionId === ev.executionId ? updated : e) };
      });
    }

    if (event.type === 'approval_requested') {
      const ev = event as WSApprovalRequested;
      setExecutions(prev => {
        for (const [msgId, list] of Object.entries(prev)) {
          const existing = list.find(e => e.executionId === ev.executionId);
          if (existing) {
            const updated = { ...existing, status: 'awaiting_approval' as const, needsApproval: true, approvalId: ev.approvalId, action: ev.action };
            return { ...prev, [msgId]: list.map(e => e.executionId === ev.executionId ? updated : e) };
          }
        }
        return prev;
      });
    }

    if (event.type === 'action_auto_approved') {
      const ev = event as WSAutoApproved;
      setExecutions(prev => {
        for (const [msgId, list] of Object.entries(prev)) {
          const existing = list.find(e => e.executionId === ev.executionId);
          if (existing) {
            return { ...prev, [msgId]: list.map(e =>
              e.executionId === ev.executionId ? { ...e, status: 'running' as const } : e
            )};
          }
        }
        return prev;
      });
    }

    if (event.type === 'session_title_updated') {
      const ev = event as WSSessionTitleUpdated;
      if (ev.sessionId === chatId) {
        queryClient.invalidateQueries({ queryKey: ['chats'] });
      }
    }

    if (event.type === 'execution_update') {
      const ev = event as WSExecutionUpdate;
      if (ev.status === 'running' && ev.messageId) {
        const newExec: InlineExecution = {
          executionId: ev.executionId,
          tool: ev.tool ?? 'unknown',
          projectName: ev.projectName,
          status: 'running',
          outputLog: '',
          result: null,
          needsApproval: false,
          approvalId: null,
          action: null,
        };
        setExecToMsg(prev => ({ ...prev, [ev.executionId]: ev.messageId! }));
        setExecutions(prev => ({
          ...prev,
          [ev.messageId!]: [...(prev[ev.messageId!] ?? []), newExec],
        }));
      }
    }
  }, [chatId, queryClient, execToMsg]);

  useEffect(() => {
    const unsub = subscribe(handleWsEvent);
    return unsub;
  }, [handleWsEvent]);

  const chatTitle = chat?.title ?? messages.find(m => m.role === 'user')?.content?.slice(0, 40) ?? 'Chat';

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-2/3 rounded-2xl" />
        <Skeleton className="ml-auto h-20 w-1/2 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-3 px-6">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{chatTitle}</div>
        </div>
      </header>

      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground/60">Send a message to get started</p>
        </div>
      ) : (
        <MessageList messages={messages} executions={executions} streamingIds={streamingIds} sessionId={chatId} />
      )}

      <MessageInput
        onSend={content => mutation.mutate(content)}
        disabled={sending}
        effort={effort}
        onEffortChange={newEffort => configMutation.mutate({ effort: newEffort, model: null })}
        model={chat?.model ?? null}
        onModelChange={model => configMutation.mutate({ model })}
        models={models}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update EmptyState.tsx**

Replace all "session" text with "chat":

```typescript
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface EmptyStateProps {
  onNewChat: () => void;
}

export default function EmptyState({ onNewChat }: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <Card className="w-full max-w-md rounded-3xl border-border/60 bg-background/72 text-center shadow-sm">
        <CardHeader>
          <CardTitle>Start a chat</CardTitle>
          <CardDescription>Talk to the agent to plan, execute, and manage work across your projects.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onNewChat}>New chat</Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors (AppLayout still imports SessionView — fix in next task)

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ChatView.tsx web/src/components/EmptyState.tsx
git commit -m "feat: add ChatView, update EmptyState text"
```

---

## Task 10: Frontend — App.tsx + AppLayout overhaul, delete old components

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/AppLayout.tsx`
- Delete: `web/src/components/IconRail.tsx`
- Delete: `web/src/components/NavPanel.tsx`
- Delete: `web/src/components/ProjectsEmptyState.tsx`
- Delete: `web/src/components/SessionView.tsx`

- [ ] **Step 1: Rewrite App.tsx**

```typescript
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RequireAuth from './components/RequireAuth.js';
import Login from './pages/Login.js';
import AppLayout from './pages/AppLayout.js';
import Settings from './pages/Settings.js';
import ChatsPage from './pages/ChatsPage.js';
import ProjectsPage from './pages/ProjectsPage.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/', element: <Navigate to="/c" replace /> },
  { path: '/s', element: <Navigate to="/c" replace /> },
  { path: '/s/:sessionId', element: <Navigate to="/c" replace /> },
  {
    path: '/',
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: 'c', element: null },
      { path: 'c/:chatId', element: null },
      { path: 'chats', element: <ChatsPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Rewrite AppLayout.tsx**

```typescript
import { useEffect } from 'react';
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Sidebar from '../components/Sidebar.js';
import ChatView from '../components/ChatView.js';
import EmptyState from '../components/EmptyState.js';
import { createChat } from '../lib/api.js';
import { connect } from '../lib/ws.js';

export default function AppLayout() {
  const { chatId } = useParams<{ chatId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    connect();
  }, []);

  async function handleNewChat() {
    const { id } = await createChat();
    await queryClient.invalidateQueries({ queryKey: ['chats'] });
    navigate(`/c/${id}`);
  }

  const isOutletPage = location.pathname === '/chats'
    || location.pathname === '/projects'
    || location.pathname === '/settings';

  const mainContent = isOutletPage
    ? <Outlet />
    : chatId
      ? <ChatView chatId={chatId} />
      : <EmptyState onNewChat={handleNewChat} />;

  return (
    <div className="flex h-full gap-2 bg-muted/45 p-3 text-foreground">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-background/58 shadow-sm backdrop-blur">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
        {mainContent}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Delete old components**

```bash
rm web/src/components/IconRail.tsx
rm web/src/components/NavPanel.tsx
rm web/src/components/ProjectsEmptyState.tsx
rm web/src/components/SessionView.tsx
```

- [ ] **Step 4: Type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Run all tests**

```bash
cd server && npx vitest run
cd web && npx vitest run
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/pages/AppLayout.tsx
git rm web/src/components/IconRail.tsx web/src/components/NavPanel.tsx web/src/components/ProjectsEmptyState.tsx web/src/components/SessionView.tsx
git commit -m "feat: new single-sidebar layout, chats/projects pages, remove old nav components"
```
