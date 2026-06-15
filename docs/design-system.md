# Design System

Unnamed uses a soft minimal product language: warm canvas, quiet borders, low shadows, compact controls, and clear hierarchy.

## Tokens

- Typography: Hanken Grotesk via `@fontsource-variable/hanken-grotesk` in `web/src/index.css`.
- Canvas: `background` is the page color. Prefer translucent `background/*` or `muted/*` for surfaces instead of pure white blocks.
- Borders: use `border-border/40` to `border-border/70` for structure. Avoid heavy boxed sections.
- Shadows: default to none or `shadow-xs`; use `shadow-sm` only for active overlays or important floating surfaces.

## Radius

- `rounded-lg`: inputs, buttons, small controls.
- `rounded-xl`: cards, dialogs, panels, lists, and app chrome.
- `rounded-2xl`: chat bubbles, execution cards, or conversational surfaces only.
- Avoid `rounded-3xl` in app chrome.

## Layout

Use `web/src/components/ui/app-layout.tsx` for common page structure:

- `PageShell`: full-height route container.
- `PageHeader`: route title, optional description, optional actions.
- `PageBody`: scrollable page body with standard padding.
- `ContentColumn`: standard centered max width.
- `PageSection`: Settings-style section with quiet dividers.
- `Surface`: shared card/panel surface.
- `EmptyPanel` and `CenteredEmptyState`: standard empty states.

## Patterns

- Prefer sections and whitespace over nested cards.
- Keep primary actions dark and restrained; use outline/ghost for secondary actions.
- Empty states should explain what appears there, then provide one clear action only when useful.
- Loading states should preserve approximate layout with skeletons rather than returning `null` on major pages.
- Error states should be visible, quiet, and local to the failed area.

## Status Indicators

Use `Badge` for all status labels — never raw `<span>` with manual padding/radius. Pick `variant="outline"` and override background/text via className for semantic color:

- Running/active: `bg-blue-500/10 text-blue-700 border-blue-200 dark:text-blue-300 dark:border-blue-900`
- Done/success: `bg-green-500/10 text-green-700 border-green-200 dark:text-green-300 dark:border-green-900`
- Error: `bg-destructive/10 text-destructive border-destructive/20`
- Cancelled/neutral: `bg-muted text-muted-foreground border-transparent`

For live activity dots (inline with text), use a `size-1.5 rounded-full` span with `bg-success` (idle) or `bg-blue-500 animate-pulse` (active). Dots are for ambient status; badges are for labeled status.

## Motion

Default to no animation. These are the only sanctioned uses:

- `transition-colors` on interactive surfaces and buttons (hover state feedback).
- `animate-pulse` on status dots and the streaming cursor.
- No route transitions, no layout animations, no scroll triggers.

Prefer CSS-only. Do not add motion libraries unless a specific interaction requires it.

## Tables

Wrap `<Table>` in a container div: `overflow-hidden rounded-xl border border-border/50 bg-background/60`. Use `TableHeader`, `TableHead`, `TableBody`, `TableRow`, `TableCell` from `@/components/ui/table`. Clickable rows get `cursor-pointer` on `TableRow`.

## Breadcrumbs

Use the `Breadcrumb` component from `@/components/ui/breadcrumb` for pages nested under a list route (e.g. project detail under Projects). Apply `text-xs` to `BreadcrumbList`. Place the breadcrumb above the page title, not inside `PageHeader` — use a custom header block when you need breadcrumb + title + tabs together.
