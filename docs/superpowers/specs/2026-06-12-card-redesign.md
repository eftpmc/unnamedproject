# Card Redesign: Execution & Campaign Cards

**Date:** 2026-06-12
**Scope:** `ExecutionCard.tsx`, `CampaignCard.tsx`, `MessageList.tsx`

## Problem

Execution cards and campaign cards are narrower than chat messages due to a double-constraint in `MessageList.tsx` (an inner wrapper on top of the outer container). They also have unequal widths between card types. The visual style (left accent border, translucent background, `rounded-lg`) does not match the soft, modern direction of the rest of the design system.

## Goals

1. Cards match the width of assistant message bubbles
2. ExecutionCard and CampaignCard have equal widths
3. Visual style is elevated panel: white, soft shadow, rounder corners, no left accent border

## Changes

### `MessageList.tsx`

Remove the inner `div.w-full.max-w-[92%].sm:max-w-[82%]` wrapper around execution cards. The outer container (`flex max-w-[94%] flex-col sm:max-w-[86%]`) is sufficient and matches the assistant message container.

**Before:**
```tsx
<div className="flex max-w-[94%] flex-col sm:max-w-[86%]">
  <div className="w-full max-w-[92%] sm:max-w-[82%]">
    {renderExecutionCard(item.execution)}
  </div>
</div>
```

**After:**
```tsx
<div className="flex max-w-[94%] flex-col sm:max-w-[86%]">
  {renderExecutionCard(item.execution)}
</div>
```

### `ExecutionCard.tsx`

**Remove entirely:**
- `STATUS_BORDER` record and all references
- `border-l-2` class from the Card
- The conditional `border-warning/30 border-l-warning/70` override on approval state

**Update Card className:**
- `rounded-lg` → `rounded-2xl`
- `bg-background/60` → `bg-background`
- `border-border/45` → `border-border/25`
- `shadow-xs` → `shadow-sm ring-1 ring-black/[0.03]`

**Tool icon box:** Wrap the existing `ToolIcon` in a `size-6 rounded-lg flex items-center justify-center` box. The box background and border tint to status color:
- `pending`: `bg-muted/60 border-border/30`
- `running`: `bg-blue-500/10 border-blue-200/50`
- `done`: `bg-success/10 border-success/25`
- `error`: `bg-destructive/10 border-destructive/20`
- `awaiting_approval`: `bg-warning/10 border-warning/25`

The `StatusIcon` (spinner/check/alert) stays inline to the left of the icon box as-is.

**Approval state background:** `bg-warning/5` stays, but drop the `border-warning/30` border override since there's no longer a left accent — the amber badge + icon box tint is sufficient.

### `CampaignCard.tsx`

**Remove:** `max-w-md` from the `Surface` className — card fills its container.

**Update Surface className:**
- Replace `rounded-lg` with `rounded-2xl`
- `bg-background/70` → `bg-background`
- `shadow-xs` → `shadow-sm ring-1 ring-black/[0.03]`

Internal border dividers stay at `border-border/35` — no change.

## Non-goals

- No changes to badge colors, status labels, or interaction behavior
- No changes to `OutputLog`, expand/collapse, approve/reject actions
- No layout changes outside the card wrapper in `MessageList.tsx`

## Testing

- Open a chat with tool use history — confirm cards are same width as assistant bubbles
- Confirm ExecutionCard and CampaignCard are equal widths
- Check running, done, error, and awaiting_approval states all render correctly
- Check dark mode — `bg-background` and `ring-black/[0.03]` should be theme-safe
