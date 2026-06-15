# Design System

Stack: **Tailwind CSS v4** · **shadcn/ui (radix-nova)** · **Lucide icons** · **Hanken Grotesk Variable**

Themes are applied via `data-theme="unnamed-light"` or `data-theme="unnamed-dark"` on `<html>`. Toggle with `useTheme()` from `@/lib/useTheme`.

---

## Color Tokens

All tokens are CSS custom properties consumed as Tailwind classes.

### Foreground hierarchy

| Token | Class | Use |
|---|---|---|
| `--foreground` | `text-foreground` | Primary text, headings, labels |
| `--fg-soft` | `text-fg-soft` | Secondary text, de-emphasized labels |
| `--muted-foreground` | `text-muted-foreground` | Placeholder, helper, metadata |
| `--faint-fg` | `text-faint-fg` | Timestamps, tertiary metadata, section labels |

### Surfaces

| Token | Class | Use |
|---|---|---|
| `--background` | `bg-background` | App root, page canvas |
| `--card` | `bg-card` | Cards, panels, elevated surfaces |
| `--muted` | `bg-muted` | Icon wells, subtle fills, code blocks |
| `--popover` | `bg-popover` | Dropdowns, tooltips, popovers |
| `--sidebar` | `bg-sidebar` | Sidebar background |

### Borders

| Token | Class | Use |
|---|---|---|
| `--border` | `border-border` | Default borders, dividers |
| `--border-soft` | `border-border-soft` | Subtle card outlines, table rows |
| `--input` | `border-input` | Form inputs |

### Interactive (primary blue)

| Token | Class | Use |
|---|---|---|
| `--primary` | `bg-primary` / `text-primary` | CTAs, active nav, brand fill |
| `--primary-foreground` | `text-primary-foreground` | Text on primary fill |
| `--accent-tint` | `bg-accent-tint` | Tinted chip/tag backgrounds |
| `--on-accent-soft` | `text-on-accent-soft` | Text on accent-tint surfaces |

### Semantic

| Token | Class | Use |
|---|---|---|
| `--success` | `text-success` / `bg-success/15` | Done, ready states |
| `--warning` | `text-warning` / `bg-warning/18` | Awaiting approval, review states |
| `--warning-foreground` | `text-warning-foreground` | Text on warning fill |
| `--destructive` | `text-destructive` / `bg-destructive/10` | Errors, rejections, delete actions |

---

## Typography

Font: **Hanken Grotesk Variable** (`font-sans`, `font-heading`). Base: 15px / 1.5 line-height.

| Use | Classes |
|---|---|
| Page title (`<h1>`) | `text-[15px] font-semibold tracking-tight text-foreground` |
| Card title | `text-base font-medium` (via `CardTitle`) |
| Section label | `text-[13px] font-semibold text-muted-foreground` |
| Body text | `text-sm text-foreground` |
| Secondary body | `text-[13px] text-muted-foreground` |
| Small metadata | `text-xs text-muted-foreground` |
| Micro / timestamps | `text-[11px] text-faint-fg` |
| Mono output / logs | `font-mono text-[12px] text-muted-foreground` |

---

## Radius Scale

Base: `--radius: 1.125rem` (18px).

| Token | Class | Approx | Use |
|---|---|---|---|
| `--radius-sm` | `rounded-sm` | ~11px | Badges, chips |
| `--radius-md` | `rounded-md` | ~14px | Small buttons, icon buttons |
| `--radius-lg` | `rounded-lg` | 18px | Cards, inputs, nav items |
| `--radius-xl` | `rounded-xl` | ~25px | Large cards, modals |
| `--radius-2xl` | `rounded-2xl` | ~34px | Sheet panels |
| `rounded-full` | `rounded-full` | pill | StatusPill, avatar badges |

---

## Layout Primitives

All from `@/components/ui/app-layout`.

```tsx
// Full page shell — use as the root of every page component
<PageShell>
  <PageHeader title="Projects" actions={<Button>New</Button>} />
  <PageBody>
    <ContentColumn>   {/* max-w-5xl, centered */}
      ...
    </ContentColumn>
  </PageBody>
</PageShell>

// Section heading within a page body
<PageSection title="Recent campaigns">...</PageSection>

// Loading skeleton while data fetches
<PageLoading rows={3} />
```

### Empty states

```tsx
// Full-page centered empty state (no data at all)
<CenteredEmptyState
  title="No projects yet"
  description="Create a project to get started."
  actionLabel="Create project"
  onAction={handleCreate}
/>

// Inline empty panel within a section (some data exists, but sub-list is empty)
<EmptyPanel
  title="No campaigns"
  description="Run a campaign to see results here."
  action={<Button size="sm">New campaign</Button>}
/>
```

### Surface

`Surface` is the base bordered card. Use it instead of raw `div` + `border` combos.

```tsx
// Static surface
<Surface className="p-4">...</Surface>

// Interactive (clickable card — adds hover lift)
<Surface interactive className="p-4" onClick={...}>...</Surface>
```

---

## Components

### Button

```tsx
import { Button } from '@/components/ui/button';

// Variants
<Button>Primary</Button>                        // filled blue CTA
<Button variant="outline">Outline</Button>      // bordered, neutral
<Button variant="secondary">Secondary</Button>  // subtle filled
<Button variant="ghost">Ghost</Button>          // no background
<Button variant="destructive">Delete</Button>   // red tinted

// Sizes
<Button size="xs" />   // h-6, text-xs
<Button size="sm" />   // h-7
<Button size="default" /> // h-8 (default)
<Button size="lg" />   // h-9
<Button size="icon" /> // h-8 w-8 square
```

**Rules:**
- Primary CTAs (page-level actions, form submits): `variant="default"`
- Secondary actions in toolbars: `variant="outline"` or `variant="ghost"`
- Destructive confirmations: `variant="destructive"`
- Icon-only controls: `size="icon"` or `size="icon-sm"`
- Never use raw `<button>` with hand-rolled Tailwind when Button fits

### StatusPill

The canonical way to display agent/campaign/execution states. Never use `Badge` for run states.

```tsx
import { StatusPill, type PillStatus } from '@/components/ui/status-pill';

<StatusPill status="running" />         // animated spinner, blue
<StatusPill status="done" />            // checkmark, green
<StatusPill status="error" />           // alert, red
<StatusPill status="awaiting_approval" /> // bell, amber
<StatusPill status="pending" />         // dot, muted
<StatusPill status="cancelled" />       // dot, muted
<StatusPill status="ready" />           // checkmark, green
<StatusPill status="review" />          // clock, amber
```

### Badge

Use for categorical labels (type tags, count chips, feature flags). Not for run states.

```tsx
import { Badge } from '@/components/ui/badge';

<Badge>Default</Badge>
<Badge variant="secondary">Tag</Badge>
<Badge variant="outline">Label</Badge>
<Badge variant="destructive">Removed</Badge>
```

### Card

Use for content containers that need header/body/footer structure.

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@/components/ui/card';

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Subtitle</CardDescription>
    <CardAction><Button size="sm">Edit</Button></CardAction>
  </CardHeader>
  <CardContent>...</CardContent>
  <CardFooter>...</CardFooter>
</Card>

// Compact variant
<Card size="sm">...</Card>
```

**Rule:** Use `Card` when you need structured header+body+footer. Use `Surface` for simpler bordered containers without that structure.

### Dialog

For confirmations and create/edit forms triggered by a user action.

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
    <div className="flex flex-col gap-3 py-2">...</div>
    <DialogFooter>
      <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      <Button onClick={handleSubmit}>Create</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Input / Textarea

```tsx
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

<Input placeholder="Project name" value={name} onChange={e => setName(e.target.value)} />
<Textarea placeholder="Description" rows={3} />
```

Always use `Label` from `@/components/ui/label` when the field has a visible label.

---

## Icons

Library: **Lucide React**. Import individually.

| Size | Use |
|---|---|
| 10–11px | Micro indicators inside StatusPill, badges |
| 13–14px | Inline with text in cards, table rows |
| 15–16px | Nav items, toolbar buttons |
| 18px | Mobile top bar, modal headers |

Always pass `strokeWidth={1.75}` for nav/decorative icons; default (2) for action icons.

---

## Patterns

### Running indicator (inline)

For showing active work inline without a StatusPill:

```tsx
<span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-on-accent-soft">
  <span className="size-1.5 animate-pulse rounded-full bg-primary" />
  {count} running
</span>
```

### Approval badge in nav

```tsx
<span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
  {count}
</span>
```

### Expandable log output

For tool output, terminal logs, agent results — see `ExecutionCard` for the full pattern. Key classes:

```tsx
<div className="max-h-44 overflow-y-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap" role="log">
  {output}
</div>
```

### Page nav tabs

Use `Tabs` from `@/components/ui/tabs` for sub-page navigation within a `PageShell`.

---

## What Not To Do

- Don't hand-roll status chips — use `StatusPill`
- Don't use `Badge` for run/execution states
- Don't use raw `<div>` + border classes when `Surface` or `Card` fits
- Don't define one-off inline colors — use the token classes above
- Don't add `text-gray-*` or `text-slate-*` — use the foreground hierarchy tokens
- Don't build empty states from scratch — use `CenteredEmptyState` or `EmptyPanel`
- Don't skip `PageShell` / `PageHeader` / `PageBody` on new pages
