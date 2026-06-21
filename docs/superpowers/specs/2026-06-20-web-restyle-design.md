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
| Accent color | Keep the blue (it's the shared design-system signal with iOS `tintColor`); no color overhaul |

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

### 4. Optional accent tidy (low priority, only if time permits)

- Keep the blue. Optionally nudge the pill **chips** (model selector, branch) from tinted-pill toward a flatter bordered chip so they read as standard UI controls. This is a nice-to-have; the font + radius changes do the heavy lifting. Will confirm visually before/after and back out if it doesn't clearly help.

## Components / files touched

- `web/package.json` — dependency swap.
- `web/src/index.css` — `@import`, `--font-sans`, `--radius`, optional body font-features.
- `rounded-full` call sites (subset): `Sidebar.tsx`, `UserMenu.tsx`, `ChatView.tsx`, `MessageList.tsx`, `ContextPanel.tsx`, `InboxPanel.tsx`, `ui/status-pill.tsx`, `ChatsPage.tsx`, `ProjectPage.tsx`, `PlanPage.tsx`, `ProjectsPage.tsx`, `Settings.tsx` — only the pill (non-circular) instances.

## Testing / verification

- **Playwright (visual)** — capture before/after screenshots of the key screens at desktop + mobile widths: Login, Chats (empty + loaded), Projects, Project detail, Settings, Chat with code block + Context panel. Compare side-by-side to confirm: font changed everywhere, no pills left where they shouldn't be, avatars/dots still round, nothing visually broke (overflow, clipped corners).
- **Existing unit tests** (`vitest`) — run `npm test` in `web/`; these are logic/markup tests and should stay green (no logic touched). Treat any failure as a regression to fix.
- **Maestro** — not used this round (iOS deferred).

## Out of scope

- Any layout, spacing, or card-structure changes.
- iOS app (separate later pass — its native font/system-color approach already avoids the "stylish" problem).
- Color-system overhaul; dark/light token values stay as-is apart from the optional chip tidy.

## Success criteria

1. No Hanken Grotesk anywhere; Inter renders across all screens in light and dark.
2. No full-pill buttons/chips; cards and controls read as standard rounded-rect (~10px family).
3. Avatars, status dots, and scrollbar thumb remain circular.
4. All existing `vitest` tests pass; Playwright before/after shows no broken layout.
5. User confirms it "feels cleaner / less stylish" while keeping the spacing & cards they like.
