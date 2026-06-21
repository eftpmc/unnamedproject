# Web Restyle — "Less Stylish, More Standard"

**Date:** 2026-06-20
**Scope:** Web app only (`web/`). iOS deferred to a later pass.
**Goal:** Keep the layout, spacing, and card structure the user likes; remove the "designed/branded" feel by swapping to a standard font and softening the oversized rounded/pill shapes.

## Motivation

The web app is well-structured (good hierarchy, spacing, card layouts) but reads as "too stylish." Three specific choices drive that impression:

1. **Hanken Grotesk** — a distinctive geometric grotesk that brands every surface.
2. **Oversized corner radius** — base `--radius: 18px` with multipliers up to ~2.9×, producing full-pill buttons and very pillowy cards.
3. Secondary: soft periwinkle accent + tinted pill chips.

The layout/spacing/cards are explicitly **out of scope** — they stay.

## Decisions (confirmed with user)

| Topic | Decision |
|---|---|
| Web font | **Inter** (variable), replacing Hanken Grotesk |
| Roundness | **Moderate** — base radius 18px → 10px; pill buttons/chips → rounded-rect; cards stay gently rounded |
| iOS | **Deferred** — no changes this round |
| Accent color | **User-changeable theme color** — preset swatches + custom hue, set in Settings → Appearance, persisted in localStorage. Default stays the current blue. |

## Design

### 1. Font swap → Inter

- Replace the dependency `@fontsource-variable/hanken-grotesk` with `@fontsource-variable/inter` in `web/package.json`.
- In `web/src/index.css`:
  - Change the `@import` from hanken-grotesk to inter.
  - Set `--font-sans: "Inter Variable", system-ui, sans-serif;`
  - Leave `--font-heading: var(--font-sans);` (headings use the same family — Inter is clean enough that a separate display face isn't needed).
- Add Inter's recommended OpenType tuning on `body` for a crisper, standard look:
  - `font-feature-settings: "cv11", "ss01";` (optional, single-story characters / stylistic clean-up) — **kept minimal; can be dropped if it reads off.**
- No component-level font class changes needed — everything flows through `--font-sans` / `font-heading`.

### 2. Soften radius

The radius scale in `index.css` is calc-derived from one token:

```
--radius: 1.125rem;           /* 18px → change to 0.625rem (10px) */
--radius-sm:  calc(var(--radius) * 0.62);   /* derived — no change needed */
--radius-md:  calc(var(--radius) * 0.8);
--radius-lg:  var(--radius);
--radius-xl:  calc(var(--radius) * 1.4);
--radius-2xl: calc(var(--radius) * 1.9);
--radius-3xl: calc(var(--radius) * 2.3);
--radius-4xl: calc(var(--radius) * 2.9);
```

- **Primary change:** `--radius: 1.125rem` → `--radius: 0.625rem` (18px → 10px). This cascades through every `rounded-md/lg/xl/2xl/3xl/4xl` automatically (85× `rounded-lg`, 41× `rounded-md`, 22× `rounded-xl`, 4× `rounded-2xl`, 1× `rounded-4xl`).
- After lowering the token, spot-check the multiplier-heavy classes (`rounded-2xl`, `rounded-4xl`) — at 10px base they become ~19px / ~29px, which is still soft-but-reasonable. Adjust only if a specific surface looks off.

### 3. Convert intentional pills (`rounded-full`, 28 uses)

`rounded-full` is used in two distinct ways — handle them differently:

- **Keep round** (circular by intent): user/brand avatars (`UserMenu.tsx`, `Sidebar.tsx` brand mark), status dots, scrollbar thumb (`ui/scroll-area.tsx`), small notification/badge dots.
- **Convert to rounded-rect** (these are the "stylish pills"): the **"New chat"** button, model/branch **chips** in the chat header, filter inputs styled as pills, and the **status-pill** component (`ui/status-pill.tsx`) → use `rounded-md` (small chips) or `rounded-lg` (buttons).

Each `rounded-full` site will be inspected individually; the rule is "is this a circle (keep) or a stadium/pill (convert)?"

### 4. User-changeable accent color

Replace the hardcoded blue with a themeable accent driven by **two CSS custom properties** so a single choice recomputes every accent token consistently in both light and dark:

- `--accent-h` — hue (oklch hue angle)
- `--accent-c` — chroma (lets neutral/muted presets dial saturation down)

**Token parametrization (`index.css`).** Rewrite the accent tokens in both the light and dark blocks to reference these vars instead of literal hue/chroma. Lightness stays per-mode (so contrast holds); only hue/chroma come from the vars:

```css
/* defaults — the current blue */
--accent-h: 252;
--accent-c: 0.085;   /* dark block uses its own 0.1 */

/* light block, rewritten */
--primary:        oklch(0.58 var(--accent-c) var(--accent-h));
--accent-tint:    oklch(0.95 calc(var(--accent-c) * 0.3) var(--accent-h));
--on-accent-soft: oklch(0.50 calc(var(--accent-c) * 1.05) var(--accent-h));
--ring:           color-mix(in oklch, oklch(0.58 var(--accent-c) var(--accent-h)) 55%, transparent);
--sidebar-primary: oklch(0.58 var(--accent-c) var(--accent-h));
/* --primary-foreground / --sidebar-primary-foreground stay near-white (light) / near-dark (dark) — readable across hues at these lightnesses */
```

The dark block mirrors this with its existing dark lightness values. Because oklch holds perceived lightness roughly constant across hue, foreground contrast stays acceptable for any chosen hue without per-color tuning.

**Presets + custom.** New `web/src/lib/accent.ts` (mirrors `theme.ts`):
- `Accent` = a small set of presets, each mapping to `{ h, c }`: e.g. **Blue** (252, 0.085 — default), **Violet** (290, 0.09), **Teal** (190, 0.08), **Green** (155, 0.08), **Amber** (70, 0.09), **Rose** (15, 0.10), plus **Slate** (252, 0.02 — near-neutral).
- Custom: a hue value (0–360) at the default chroma. Stored as `{ h, c }` too, so presets and custom share one storage shape.
- `STORAGE_KEY = 'accent'`; `getStoredAccent()`, `getInitialAccent()` (default Blue), `applyAccent({h,c})` → sets `--accent-h` / `--accent-c` on `document.documentElement.style`, `setStoredAccent()` persists + applies.
- `web/src/lib/useAccent.ts` — `useState` + setter, mirroring `useTheme.ts`.

**Apply before paint.** In `main.tsx` (or wherever `getInitialTheme()` runs at startup), also call `applyAccent(getInitialAccent())` before first render so there's no flash of the default blue.

**Settings UI.** Add an **Appearance** section to Settings (the screens already have an Account-style tab pattern). It contains:
- the existing light/dark control (if not already surfaced there), and
- an **Accent** row: a row of preset swatch buttons (the active one shows a ring/check) + a **Custom** affordance that reveals a hue slider (`<input type="range" min=0 max=360>`) or a native color input. Selecting any option calls `setStoredAccent` immediately (live preview, no save button — consistent with the instant theme toggle).

**iOS note (future):** because the accent is just `{h, c}`, the later iOS pass can read the same stored choice (when settings sync exists) and map it to `view.tintColor`. Out of scope now, but the shape is chosen to make that trivial.

## Components / files touched

- `web/package.json` — dependency swap.
- `web/src/index.css` — `@import`, `--font-sans`, `--radius`, optional body font-features, **accent token parametrization (`--accent-h`/`--accent-c`)**.
- `rounded-full` call sites (subset): `Sidebar.tsx`, `UserMenu.tsx`, `ChatView.tsx`, `MessageList.tsx`, `ContextPanel.tsx`, `InboxPanel.tsx`, `ui/status-pill.tsx`, `ChatsPage.tsx`, `ProjectPage.tsx`, `PlanPage.tsx`, `ProjectsPage.tsx`, `Settings.tsx` — only the pill (non-circular) instances.
- **New:** `web/src/lib/accent.ts`, `web/src/lib/useAccent.ts`.
- `web/src/main.tsx` — apply stored accent before first render.
- `web/src/pages/Settings.tsx` — Appearance section with theme + accent controls.

## Testing / verification

- **Playwright (visual)** — capture before/after screenshots of the key screens at desktop + mobile widths: Login, Chats (empty + loaded), Projects, Project detail, Settings, Chat with code block + Context panel. Compare side-by-side to confirm: font changed everywhere, no pills left where they shouldn't be, avatars/dots still round, nothing visually broke (overflow, clipped corners).
- **Accent verification (Playwright)** — in Settings → Appearance, select a non-default preset and a custom hue; assert `getComputedStyle(document.documentElement).getPropertyValue('--accent-h')` changes and that `--primary` resolves to the new hue; screenshot the sidebar "New chat" button + active nav in two accents to confirm it recolors live; reload to confirm persistence; verify it holds in both light and dark.
- **Existing unit tests** (`vitest`) — run `npm test` in `web/`; these are logic/markup tests and should stay green (no logic touched). Add a small unit test for `accent.ts` (default, persistence round-trip, apply sets the CSS vars). Treat any existing failure as a regression to fix.
- **Maestro** — not used this round (iOS deferred).

## Out of scope

- Any layout, spacing, or card-structure changes.
- iOS app (separate later pass — its native font/system-color approach already avoids the "stylish" problem).
- Color-system overhaul beyond accent — the neutral slate surfaces and light/dark lightness values stay as-is; only the **accent** hue/chroma becomes user-driven.
- Server-side persistence of the accent (client-only localStorage this round); iOS consumption of the accent (future).

## Success criteria

1. No Hanken Grotesk anywhere; Inter renders across all screens in light and dark.
2. No full-pill buttons/chips; cards and controls read as standard rounded-rect (~10px family).
3. Avatars, status dots, and scrollbar thumb remain circular.
4. Accent is user-changeable via Settings → Appearance (presets + custom hue), applies live across the whole UI in light and dark, and persists across reloads. Default remains the current blue.
5. All existing `vitest` tests pass (+ new `accent.ts` test); Playwright before/after shows no broken layout and confirms accent recoloring.
6. User confirms it "feels cleaner / less stylish" while keeping the spacing & cards they like.
