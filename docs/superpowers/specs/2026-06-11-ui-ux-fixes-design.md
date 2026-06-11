# UI/UX Fixes Design

**Date:** 2026-06-11  
**Scope:** 8 targeted fixes from Playwright UX review

---

## 1. Markdown rendering in assistant messages

**File:** `web/src/components/MessageList.tsx`

Install `react-markdown`. Replace plain `{msg.content}` in assistant bubbles with `<ReactMarkdown components={...}>`. Scope custom renderers to assistant messages only:
- `p`: `className="mb-2 last:mb-0"`
- `strong`: `className="font-semibold"`
- `code` (inline): `className="bg-muted rounded px-1 font-mono text-[13px]"`
- `pre`: `className="bg-muted rounded-lg p-3 my-2 overflow-x-auto"`
- `ul`/`ol`: `className="ml-4 mb-2 list-disc"`/`"list-decimal"`
- `li`: `className="mb-0.5"`

Remove `whitespace-pre-wrap` from the assistant bubble div. User messages keep plain text + `whitespace-pre-wrap`.

---

## 2. Scroll to latest on load

**File:** `web/src/components/MessageList.tsx`

Replace Radix `ScrollArea` with a plain `overflow-y-auto` div so `scrollIntoView` works through the real DOM scroll ancestor. Track first render with `useRef<boolean>(false)`: use `behavior: 'instant'` on initial load, `'smooth'` on subsequent updates. Dependency stays `[messages.length]`.

---

## 3. Projects panel — main area empty state

**Files:** `web/src/pages/AppLayout.tsx`, `web/src/components/ProjectsEmptyState.tsx` (new)

When `activePanel === 'projects'` (and `!isSettings`), render `<ProjectsEmptyState />` in `<main>` regardless of `sessionId`. Component: centered card with "Your projects" heading, "Set up a project in Settings to get started." body, and a "Go to Settings" button that navigates to `/settings`.

---

## 4. New session hint state

**File:** `web/src/components/SessionView.tsx`

When `messages.length === 0 && !isLoading`, render a centered ghost hint in place of the message list: muted text "Send a message to get started". Input bar still shows normally at the bottom.

---

## 5. Remove "Agent session" subtitle

**File:** `web/src/components/SessionView.tsx`

Delete the hardcoded `<div className="text-xs text-muted-foreground">Agent session</div>` line from the session header.

---

## 6. Auto session naming

### Server

**Files:** `server/src/routes/sessions.ts`, `server/src/services/agent.ts`

1. Update `PATCH /sessions/:id` to accept `title` in the body and write it to the DB.
2. In `agent.ts`, after the first assistant `message_created` event for a session with `title = null`, fire a background (non-blocking) async call:
   - Fetch the lead agent Anthropic API key for the user.
   - Call Anthropic with `claude-haiku-4-5-20251001`, max_tokens 20, prompt: `"Write a short title (4-6 words) for this conversation. Only the title, no quotes or punctuation.\n\nUser: {first_user_message}"`.
   - Write the returned title to the session in the DB.
   - Broadcast `{ type: 'session_title_updated', sessionId, title }` via the WS socket.

### Frontend

**Files:** `web/src/types.ts`, `web/src/components/SessionView.tsx`

- Add `WSSessionTitleUpdated` type to `WSEvent` union.
- In `SessionView.tsx` WS event handler, on `session_title_updated`: call `queryClient.invalidateQueries({ queryKey: ['sessions'] })`.

---

## 7. Delete confirmations

**Files:** `web/src/components/ui/confirm-dialog.tsx` (new), `web/src/pages/Settings.tsx`

New `ConfirmDialog` component props: `title`, `description`, `confirmLabel`, `onConfirm`, `onCancel`. Wraps shadcn `Dialog` with a destructive-styled confirm button.

In `Settings.tsx`:
- Add `pendingDelete` state: `{ kind: 'connection' | 'project', id: string } | null`.
- `DeleteBtn` sets `pendingDelete` instead of calling mutation directly.
- Render `<ConfirmDialog>` when `pendingDelete !== null`; on confirm, call the appropriate mutation and clear state.

---

## 8. MCP card hint text

**File:** `web/src/pages/Settings.tsx`

Change the "Add MCP Server" dashed card `CardDescription` from `"Expose extra tools to workspaces."` to `"Run an MCP server process (command + args) to expose extra tools."`.
