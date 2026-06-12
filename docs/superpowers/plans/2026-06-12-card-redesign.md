# Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resize execution and campaign cards to match chat bubble width and apply an elevated-panel visual style (white, soft shadow, rounder corners, no left accent border).

**Architecture:** Three files change. `MessageList.tsx` removes a double-constraint wrapper so cards share the same width container as assistant messages. `ExecutionCard.tsx` drops the left accent border system and adopts the elevated panel style. `CampaignCard.tsx` drops its fixed max-width and matches the same elevated panel style.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest + Testing Library

---

## File Map

| File | Change |
|------|--------|
| `web/src/components/MessageList.tsx` | Remove inner `div` wrapper around execution cards |
| `web/src/components/ExecutionCard.tsx` | Remove `STATUS_BORDER`, update Card classes, add icon box |
| `web/src/components/CampaignCard.tsx` | Remove `max-w-md`, update Surface classes |

---

### Task 1: Fix execution card width in MessageList

**Files:**
- Modify: `web/src/components/MessageList.tsx:119-126`
- Test: `web/src/components/MessageList.test.tsx`

- [ ] **Step 1: Add a width regression test**

Add this test to `web/src/components/MessageList.test.tsx` inside the `describe('MessageList')` block:

```tsx
it('renders execution cards in the same container as assistant messages', () => {
  const messages: Message[] = [
    { id: 'user-1', role: 'user', content: 'Do the thing', created_at: 1 },
  ];
  const executions = {
    'user-1': [{
      executionId: 'exec-1',
      tool: 'invoke_claude_code',
      status: 'done' as const,
      outputLog: '',
      result: null,
      createdAt: 2,
      needsApproval: false,
      approvalId: null,
      action: null,
    }],
  };

  const { container } = render(<MessageList messages={messages} executions={executions} />);
  // Execution card wrapper should NOT have the inner restrictive div
  // (max-w-[92%] / sm:max-w-[82%])
  const innerConstraint = container.querySelector('[class*="max-w-\\[92"]');
  expect(innerConstraint).toBeNull();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd web && npm test -- --reporter=verbose MessageList
```

Expected: FAIL — `innerConstraint` is found (the inner div currently exists).

- [ ] **Step 3: Remove the inner wrapper div**

In `web/src/components/MessageList.tsx`, find the execution item render block (around line 119) and replace:

```tsx
<div key={`exec-${item.execution.executionId}`} className="flex max-w-[94%] flex-col sm:max-w-[86%]">
  <div className="w-full max-w-[92%] sm:max-w-[82%]">
    {renderExecutionCard(item.execution)}
  </div>
</div>
```

with:

```tsx
<div key={`exec-${item.execution.executionId}`} className="flex max-w-[94%] flex-col sm:max-w-[86%]">
  {renderExecutionCard(item.execution)}
</div>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd web && npm test -- --reporter=verbose MessageList
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/MessageList.tsx web/src/components/MessageList.test.tsx
git commit -m "fix: remove double-constraint wrapper on execution cards"
```

---

### Task 2: Redesign ExecutionCard — remove left border, update style

**Files:**
- Modify: `web/src/components/ExecutionCard.tsx`
- Test: `web/src/components/ExecutionCard.test.tsx`

- [ ] **Step 1: Add a test asserting no left border classes**

Add this test to `web/src/components/ExecutionCard.test.tsx` inside the `describe('ExecutionCard')` block:

```tsx
it('does not apply a left accent border class', () => {
  const { container } = render(<ExecutionCard {...baseCard} status="running" />);
  const card = container.firstChild as HTMLElement;
  // None of the status border classes should be present
  expect(card.className).not.toMatch(/border-l-/);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd web && npm test -- --reporter=verbose ExecutionCard
```

Expected: FAIL — card currently has `border-l-2` and a status border colour class.

- [ ] **Step 3: Remove STATUS_BORDER and update Card classes**

Replace the entire `STATUS_BORDER` record and update the Card:

**Remove** the `STATUS_BORDER` record (lines ~68-74):
```ts
// DELETE THIS BLOCK:
const STATUS_BORDER: Record<ExecutionStatus, string> = {
  pending: 'border-l-muted-foreground/25',
  running: 'border-l-blue-400/70',
  done: 'border-l-success/65',
  error: 'border-l-destructive/70',
  awaiting_approval: 'border-l-warning/70',
};
```

**Update** the Card `className` (around line 149-153). Replace:
```tsx
<Card className={cn(
  'overflow-hidden rounded-lg border-border/45 border-l-2 bg-background/60 py-0 shadow-xs',
  STATUS_BORDER[status],
  status === 'awaiting_approval' && !decided ? 'border-warning/30 border-l-warning/70 bg-warning/5' : '',
)}>
```

with:
```tsx
<Card className={cn(
  'overflow-hidden rounded-2xl border-border/25 bg-background py-0 shadow-sm ring-1 ring-black/[0.03]',
  status === 'awaiting_approval' && !decided ? 'bg-warning/5' : '',
)}>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd web && npm test -- --reporter=verbose ExecutionCard
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ExecutionCard.tsx web/src/components/ExecutionCard.test.tsx
git commit -m "fix: remove left accent border from ExecutionCard, apply elevated panel style"
```

---

### Task 3: Add status-tinted icon box to ExecutionCard

**Files:**
- Modify: `web/src/components/ExecutionCard.tsx`
- Test: `web/src/components/ExecutionCard.test.tsx`

The tool icon currently renders as a bare icon. Wrap it in a small rounded box whose background tints to the current status colour — this replaces the status signal that the left border was providing.

- [ ] **Step 1: Add a test for the icon box**

Add this test to `web/src/components/ExecutionCard.test.tsx`:

```tsx
it('renders a tool icon box with status-tinted background', () => {
  const { container } = render(<ExecutionCard {...baseCard} status="done" />);
  const iconBox = container.querySelector('[data-testid="tool-icon-box"]');
  expect(iconBox).toBeInTheDocument();
  expect(iconBox?.className).toMatch(/bg-success/);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd web && npm test -- --reporter=verbose ExecutionCard
```

Expected: FAIL — no element with `data-testid="tool-icon-box"` exists yet.

- [ ] **Step 3: Add ICON_BOX_CLASS record and wrap ToolIcon**

Add a new record after `STATUS_ICON_CLASS` (around line 98):

```ts
const ICON_BOX_CLASS: Record<ExecutionStatus, string> = {
  pending: 'bg-muted/60 border-border/30',
  running: 'bg-blue-500/10 border-blue-200/50',
  done: 'bg-success/10 border-success/25',
  error: 'bg-destructive/10 border-destructive/20',
  awaiting_approval: 'bg-warning/10 border-warning/25',
};
```

Then in the JSX, find the line rendering `ToolIcon` (around line 166):
```tsx
<ToolIcon size={14} className="shrink-0 text-muted-foreground/55" />
```

Replace it with:
```tsx
<span
  data-testid="tool-icon-box"
  className={cn(
    'flex size-6 shrink-0 items-center justify-center rounded-lg border',
    decided === 'approved' ? 'bg-success/10 border-success/25' :
    decided === 'rejected' ? 'bg-destructive/10 border-destructive/20' :
    ICON_BOX_CLASS[status],
  )}
>
  <ToolIcon size={12} className="text-foreground/60" />
</span>
```

- [ ] **Step 4: Run all ExecutionCard tests**

```bash
cd web && npm test -- --reporter=verbose ExecutionCard
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ExecutionCard.tsx web/src/components/ExecutionCard.test.tsx
git commit -m "feat: add status-tinted icon box to ExecutionCard"
```

---

### Task 4: Redesign CampaignCard — remove max-width, update style

**Files:**
- Modify: `web/src/components/CampaignCard.tsx`

No new tests needed — the visual change is covered by visual inspection. Existing snapshot/render tests (if any) would need updating, but there are none for CampaignCard.

- [ ] **Step 1: Update Surface className**

In `web/src/components/CampaignCard.tsx` at line 97, replace:

```tsx
<Surface className="w-full max-w-md overflow-hidden rounded-lg bg-background/70 shadow-xs">
```

with:

```tsx
<Surface className="w-full overflow-hidden rounded-2xl border-border/25 bg-background shadow-sm ring-1 ring-black/[0.03]">
```

- [ ] **Step 2: Run full test suite to catch regressions**

```bash
cd web && npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/CampaignCard.tsx
git commit -m "fix: remove max-w-md from CampaignCard, apply elevated panel style"
```

---

### Task 5: Visual verification

- [ ] **Step 1: Open the app and navigate to the Remotion chat**

Open `http://localhost:5173`. Navigate to the "Remotion Window Code Editing Video" chat in the sidebar.

- [ ] **Step 2: Verify card widths match assistant bubbles**

Confirm that execution cards (e.g. "Project Query · remotion-code-editor-video") are the same width as the assistant message bubbles below them. There should be no inner indent.

- [ ] **Step 3: Verify CampaignCard width**

If a campaign card is visible, confirm it stretches to the same width as execution cards and assistant messages — not capped at `max-w-md`.

- [ ] **Step 4: Verify no left accent border**

Confirm the left edge of each execution card is a uniform soft border — no coloured accent stripe.

- [ ] **Step 5: Verify icon boxes**

Confirm each execution card shows a small rounded icon box whose background tint reflects the status (blue tint for running, green for done, etc.).

- [ ] **Step 6: Check dark mode if applicable**

Toggle to dark mode and confirm `bg-background` and `ring-black/[0.03]` look correct (no harsh white flash or invisible ring).
