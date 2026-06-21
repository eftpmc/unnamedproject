# Web Restyle (Standard Font + Softer Radius + Changeable Accent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web app feel less "designed/branded" — swap Hanken Grotesk for Inter, soften the oversized corner radius, convert stylistic pills to rounded-rects, and replace the hardcoded blue accent with a user-changeable theme color (presets + custom hue) — while keeping the layout, spacing, and cards intact.

**Architecture:** Almost everything flows through CSS custom properties in `web/src/index.css`. Font and radius are single-token changes. The accent becomes two parametrized vars (`--accent-h`, `--accent-c`) that every accent token references; a small `lib/accent.ts` (mirroring the existing `lib/theme.ts`) persists the choice to localStorage and applies it to `document.documentElement.style`, with a pre-paint inline script in `index.html` (mirroring the existing theme script) to avoid a flash. A new Settings → Appearance tab exposes presets + a custom hue slider.

**Tech Stack:** React 19, TypeScript (NodeNext module resolution — **all relative imports use `.js` extensions**), Tailwind CSS v4 (`@theme inline` tokens), Vite 6, Vitest 2 (jsdom). Fonts via `@fontsource-variable/*`.

## Global Constraints

- All relative TS imports use `.js` extensions (e.g. `import { applyAccent } from './accent.js'`) — NodeNext resolution; copy the existing `lib/theme.ts` / `lib/useTheme.ts` style exactly.
- No new dependencies except `@fontsource-variable/inter`; remove `@fontsource-variable/hanken-grotesk`.
- Do not change layout, spacing, grid, or card structure. Only font, radius, pill shapes, and accent tokens.
- Colors stay in oklch. Neutral slate surfaces and per-mode lightness values are unchanged; only accent hue/chroma become variable.
- Keep the default accent visually identical to today's blue (light `oklch(0.58 0.085 252)`, dark `oklch(0.7 0.1 252)`).
- Run all web commands from the `web/` directory. Test runner: `npm test` (vitest) — must stay green.

---

### Task 1: Swap web font to Inter

**Files:**
- Modify: `web/package.json` (dependencies)
- Modify: `web/src/index.css:4` (`@import`), `web/src/index.css:11` (`--font-sans`)

**Interfaces:**
- Consumes: nothing.
- Produces: `--font-sans` now resolves to Inter; no API surface.

- [ ] **Step 1: Swap the dependency**

In `web/`, run:
```bash
npm uninstall @fontsource-variable/hanken-grotesk && npm install @fontsource-variable/inter
```
Expected: `web/package.json` dependencies now list `@fontsource-variable/inter` and no longer list `hanken-grotesk`.

- [ ] **Step 2: Update the font import in CSS**

In `web/src/index.css`, change line 4 from:
```css
@import "@fontsource-variable/hanken-grotesk";
```
to:
```css
@import "@fontsource-variable/inter";
```

- [ ] **Step 3: Point --font-sans at Inter**

In `web/src/index.css`, change line 11 from:
```css
  --font-sans: "Hanken Grotesk Variable", system-ui, sans-serif;
```
to:
```css
  --font-sans: "Inter Variable", system-ui, sans-serif;
```
(Leave line 10 `--font-heading: var(--font-sans);` as-is — headings share Inter.)

- [ ] **Step 4: Verify the build and that Hanken is gone**

Run:
```bash
cd web && npx tsc -b && grep -rin "hanken" src package.json || echo "NO HANKEN REFERENCES"
```
Expected: tsc succeeds (no output / exit 0) and the grep prints `NO HANKEN REFERENCES`.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/src/index.css
git commit -m "style(web): swap Hanken Grotesk for Inter"
```

---

### Task 2: Soften the corner radius

**Files:**
- Modify: `web/src/index.css:119` (`--radius`)

**Interfaces:**
- Consumes: nothing.
- Produces: smaller base radius; the calc-derived `--radius-sm/md/lg/xl/2xl/3xl/4xl` scale (lines 50-56) shrinks proportionally — no other edits needed.

- [ ] **Step 1: Lower the base radius token**

In `web/src/index.css`, change line 119 from:
```css
  --radius: 1.125rem;
```
to:
```css
  --radius: 0.625rem;
```
This cascades through every `rounded-md/lg/xl/2xl/3xl/4xl` (85× `rounded-lg`, 41× `rounded-md`, 22× `rounded-xl`, 4× `rounded-2xl`, 1× `rounded-4xl`), including the "New chat" button and the chat-header model/branch chips, whose roundness comes from this scale.

- [ ] **Step 2: Verify the build**

Run:
```bash
cd web && npx vite build
```
Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/index.css
git commit -m "style(web): soften corner radius 18px -> 10px base"
```

---

### Task 3: Convert stylistic pills to rounded-rects

Only **chip/badge** pills convert. Circular dots, avatars, icon circles, notification badges, progress bars, the scrollbar thumb, the drag handle, and the chat "jump to latest" floating pill stay `rounded-full` (those are conventional circles/bars, not stylistic flourishes).

**Files:**
- Modify: `web/src/components/ui/status-pill.tsx:64`
- Modify: `web/src/pages/ChatsPage.tsx:116`
- Modify: `web/src/pages/ProjectPage.tsx:218`
- Modify: `web/src/pages/PlanPage.tsx:316`, `web/src/pages/PlanPage.tsx:345`

**Interfaces:**
- Consumes: nothing.
- Produces: no API change — class-only edits.

- [ ] **Step 1: status-pill component**

In `web/src/components/ui/status-pill.tsx:64`, change `rounded-full` to `rounded-md` in the class string:
```
'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium',
```

- [ ] **Step 2: ChatsPage filter chip**

In `web/src/pages/ChatsPage.tsx:116`, change `rounded-full` to `rounded-md`:
```
className="flex items-center gap-1 rounded-md border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
```

- [ ] **Step 3: ProjectPage "Connected" chip**

In `web/src/pages/ProjectPage.tsx:218`, change `rounded-full` to `rounded-md`:
```
<span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
```

- [ ] **Step 4: PlanPage tag chips (two)**

In `web/src/pages/PlanPage.tsx`, at lines 316 and 345, change each `rounded-full` to `rounded-md`:
```
<span className="rounded-md border border-border-soft bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
```

- [ ] **Step 5: Verify only intended pills changed**

Run:
```bash
cd web && grep -rn "rounded-full" src/components/ui/status-pill.tsx src/pages/ChatsPage.tsx src/pages/ProjectPage.tsx src/pages/PlanPage.tsx
```
Expected: status-pill.tsx, ChatsPage.tsx, ProjectPage.tsx show **no** `rounded-full`; PlanPage.tsx still shows the 3 legitimate circular/bar uses (lines ~64, ~266, ~268, ~391) but **not** the two tag chips.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ui/status-pill.tsx web/src/pages/ChatsPage.tsx web/src/pages/ProjectPage.tsx web/src/pages/PlanPage.tsx
git commit -m "style(web): convert stylistic chips from pill to rounded-rect"
```

---

### Task 4: Accent state module (`accent.ts` + `useAccent.ts`) with tests

**Files:**
- Create: `web/src/lib/accent.ts`
- Create: `web/src/lib/useAccent.ts`
- Test: `web/src/lib/accent.test.ts`

**Interfaces:**
- Produces:
  - `interface Accent { h: number; c: number }`
  - `interface AccentPreset extends Accent { id: string; label: string }`
  - `const ACCENT_PRESETS: AccentPreset[]`
  - `const DEFAULT_ACCENT: Accent` (= `{ h: 252, c: 0.085 }`)
  - `getStoredAccent(): Accent | null`
  - `getInitialAccent(): Accent`
  - `applyAccent(accent: Accent): void` — sets `--accent-h` / `--accent-c` on `document.documentElement`
  - `setStoredAccent(accent: Accent): void` — persists to localStorage key `'accent'` then applies
  - `useAccent(): { accent: Accent; changeAccent: (next: Accent) => void }`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/accent.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStoredAccent,
  getInitialAccent,
  applyAccent,
  setStoredAccent,
  DEFAULT_ACCENT,
  ACCENT_PRESETS,
} from './accent';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

describe('accent', () => {
  it('returns null when nothing stored', () => {
    expect(getStoredAccent()).toBeNull();
  });

  it('falls back to the default accent', () => {
    expect(getInitialAccent()).toEqual(DEFAULT_ACCENT);
  });

  it('persists and retrieves an accent round-trip', () => {
    setStoredAccent({ h: 152, c: 0.085 });
    expect(getStoredAccent()).toEqual({ h: 152, c: 0.085 });
    expect(getInitialAccent()).toEqual({ h: 152, c: 0.085 });
  });

  it('ignores malformed stored values', () => {
    localStorage.setItem('accent', 'not json');
    expect(getStoredAccent()).toBeNull();
    localStorage.setItem('accent', JSON.stringify({ h: 'x' }));
    expect(getStoredAccent()).toBeNull();
  });

  it('applies the accent to the document element as CSS vars', () => {
    applyAccent({ h: 70, c: 0.09 });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--accent-h')).toBe('70');
    expect(root.style.getPropertyValue('--accent-c')).toBe('0.09');
  });

  it('ships a blue default preset matching DEFAULT_ACCENT', () => {
    const blue = ACCENT_PRESETS.find(p => p.id === 'blue');
    expect(blue).toMatchObject(DEFAULT_ACCENT);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd web && npx vitest run src/lib/accent.test.ts
```
Expected: FAIL — cannot resolve `./accent`.

- [ ] **Step 3: Implement `accent.ts`**

Create `web/src/lib/accent.ts`:
```ts
export interface Accent {
  h: number;
  c: number;
}

export interface AccentPreset extends Accent {
  id: string;
  label: string;
}

export const DEFAULT_ACCENT: Accent = { h: 252, c: 0.085 };

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'blue', label: 'Blue', h: 252, c: 0.085 },
  { id: 'violet', label: 'Violet', h: 292, c: 0.095 },
  { id: 'teal', label: 'Teal', h: 195, c: 0.08 },
  { id: 'green', label: 'Green', h: 152, c: 0.085 },
  { id: 'amber', label: 'Amber', h: 70, c: 0.09 },
  { id: 'rose', label: 'Rose', h: 15, c: 0.1 },
  { id: 'slate', label: 'Slate', h: 252, c: 0.02 },
];

const STORAGE_KEY = 'accent';

export function getStoredAccent(): Accent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.h === 'number' && typeof parsed?.c === 'number') {
      return { h: parsed.h, c: parsed.c };
    }
  } catch {
    /* ignore malformed value */
  }
  return null;
}

export function getInitialAccent(): Accent {
  return getStoredAccent() ?? DEFAULT_ACCENT;
}

export function applyAccent(accent: Accent): void {
  const root = document.documentElement;
  root.style.setProperty('--accent-h', String(accent.h));
  root.style.setProperty('--accent-c', String(accent.c));
}

export function setStoredAccent(accent: Accent): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accent));
  applyAccent(accent);
}
```

- [ ] **Step 4: Implement `useAccent.ts`**

Create `web/src/lib/useAccent.ts`:
```ts
import { useState, useCallback } from 'react';
import { type Accent, getInitialAccent, setStoredAccent } from './accent.js';

export function useAccent() {
  const [accent, setAccent] = useState<Accent>(getInitialAccent);

  const changeAccent = useCallback((next: Accent) => {
    setStoredAccent(next);
    setAccent(next);
  }, []);

  return { accent, changeAccent };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd web && npx vitest run src/lib/accent.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/accent.ts web/src/lib/useAccent.ts web/src/lib/accent.test.ts
git commit -m "feat(web): accent theme state module with presets"
```

---

### Task 5: Parametrize accent tokens in CSS

**Files:**
- Modify: `web/src/index.css` light block (lines ~86-89, ~106, ~111) and dark block (lines ~148-151, ~168, ~173)

**Interfaces:**
- Consumes: `--accent-h` / `--accent-c` (set at runtime by `applyAccent`; default via `var()` fallback).
- Produces: every accent token now derives from the two vars. With no override, output is identical to today's blue.

- [ ] **Step 1: Rewrite the light-block accent tokens**

In `web/src/index.css`, in the `:root, [data-theme="unnamed-light"]` block, replace these lines:
```css
  /* Interactive blue */
  --primary:             oklch(0.58 0.085 252);
  --primary-foreground:  oklch(0.99 0.004 250);
  --accent-tint:         oklch(0.95 0.025 252);
  --on-accent-soft:      oklch(0.5 0.09 252);
```
with:
```css
  /* Interactive accent (hue/chroma are user-driven via --accent-h/--accent-c) */
  --primary:             oklch(0.58 var(--accent-c, 0.085) var(--accent-h, 252));
  --primary-foreground:  oklch(0.99 0.004 250);
  --accent-tint:         oklch(0.95 calc(var(--accent-c, 0.085) * 0.3) var(--accent-h, 252));
  --on-accent-soft:      oklch(0.5 calc(var(--accent-c, 0.085) * 1.05) var(--accent-h, 252));
```
Then change the light `--ring` line:
```css
  --ring: color-mix(in oklch, oklch(0.58 0.085 252) 55%, transparent);
```
to:
```css
  --ring: color-mix(in oklch, oklch(0.58 var(--accent-c, 0.085) var(--accent-h, 252)) 55%, transparent);
```
Then change the light `--sidebar-primary` line:
```css
  --sidebar-primary:             oklch(0.58 0.085 252);
```
to:
```css
  --sidebar-primary:             oklch(0.58 var(--accent-c, 0.085) var(--accent-h, 252));
```

- [ ] **Step 2: Rewrite the dark-block accent tokens**

In the `[data-theme="unnamed-dark"]` block, replace:
```css
  /* Interactive blue */
  --primary:             oklch(0.7 0.1 256);
  --primary-foreground:  oklch(0.18 0.02 258);
  --accent-tint:         oklch(0.5 0.1 256 / 0.2);
  --on-accent-soft:      oklch(0.78 0.09 256);
```
with:
```css
  /* Interactive accent (hue/chroma are user-driven via --accent-h/--accent-c) */
  --primary:             oklch(0.7 var(--accent-c, 0.1) var(--accent-h, 252));
  --primary-foreground:  oklch(0.18 0.02 258);
  --accent-tint:         oklch(0.5 var(--accent-c, 0.1) var(--accent-h, 252) / 0.2);
  --on-accent-soft:      oklch(0.78 calc(var(--accent-c, 0.1) * 0.9) var(--accent-h, 252));
```
Then change the dark `--ring`:
```css
  --ring: color-mix(in oklch, oklch(0.7 0.1 256) 55%, transparent);
```
to:
```css
  --ring: color-mix(in oklch, oklch(0.7 var(--accent-c, 0.1) var(--accent-h, 252)) 55%, transparent);
```
Then change the dark `--sidebar-primary`:
```css
  --sidebar-primary:             oklch(0.7 0.1 256);
```
to:
```css
  --sidebar-primary:             oklch(0.7 var(--accent-c, 0.1) var(--accent-h, 252));
```

- [ ] **Step 3: Verify the build**

Run:
```bash
cd web && npx vite build
```
Expected: build completes; no CSS errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/index.css
git commit -m "feat(web): parametrize accent tokens on --accent-h/--accent-c"
```

---

### Task 6: Apply accent pre-paint (no flash)

**Files:**
- Modify: `web/index.html` (inline head script, after the existing theme IIFE)

**Interfaces:**
- Consumes: localStorage key `'accent'` (shape `{h:number,c:number}`) written by `setStoredAccent`.
- Produces: `--accent-h` / `--accent-c` set on `<html>` before first paint.

- [ ] **Step 1: Add the accent IIFE**

In `web/index.html`, immediately after the existing theme `(function(){...})();` block inside `<head>`, add:
```html
    <script>
      (function () {
        try {
          var raw = localStorage.getItem('accent');
          if (!raw) return;
          var a = JSON.parse(raw);
          if (typeof a.h === 'number' && typeof a.c === 'number') {
            var root = document.documentElement;
            root.style.setProperty('--accent-h', String(a.h));
            root.style.setProperty('--accent-c', String(a.c));
          }
        } catch (e) {}
      })();
    </script>
```

- [ ] **Step 2: Verify the build**

Run:
```bash
cd web && npx vite build
```
Expected: build completes; `dist/index.html` contains the new inline script.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): apply stored accent before paint to avoid flash"
```

---

### Task 7: Settings → Appearance tab (theme + accent UI)

**Files:**
- Modify: `web/src/pages/Settings.tsx` (Tab type + TABS array + new tab body + `AppearanceSettings` component + imports)

**Interfaces:**
- Consumes: `useTheme()` from `../lib/useTheme.js`; `useAccent()` + `ACCENT_PRESETS` from `../lib/accent.js` / `../lib/useAccent.js`; existing local helpers `SectionLabel`, `SettingRow`, `SettingRowInfo`, `HintText`, `cn`, `Button`, `Label`.
- Produces: a new `'appearance'` tab; live accent/theme switching.

- [ ] **Step 1: Add imports**

At the top of `web/src/pages/Settings.tsx`, after the existing `usePageTitle` import (line 32), add:
```ts
import { useTheme } from '../lib/useTheme.js';
import { useAccent } from '../lib/useAccent.js';
import { ACCENT_PRESETS } from '../lib/accent.js';
```

- [ ] **Step 2: Add the tab to the type and list**

Change the `Tab` type (line 35) to include `'appearance'`:
```ts
type Tab = 'agents' | 'tools' | 'mcp' | 'workspace' | 'memory' | 'appearance' | 'account';
```
And in the `TABS` array (lines 37-44), add an entry before `account`:
```ts
  { id: 'memory', label: 'Memory' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'account', label: 'Account' },
```

- [ ] **Step 3: Add the AppearanceSettings component**

Add this component near the other module-scope helpers (e.g. just above `export default function Settings()` at line 183):
```tsx
function AppearanceSettings() {
  const { theme, toggleTheme } = useTheme();
  const { accent, changeAccent } = useAccent();
  const activePresetId =
    ACCENT_PRESETS.find(p => p.h === accent.h && p.c === accent.c)?.id ?? 'custom';

  return (
    <div className="flex flex-col gap-7">
      <div>
        <SectionLabel>Theme</SectionLabel>
        <SettingRow>
          <SettingRowInfo
            title="Appearance"
            description={theme === 'unnamed-dark' ? 'Dark' : 'Light'}
          />
          <Button size="sm" variant="outline" onClick={toggleTheme}>
            Switch to {theme === 'unnamed-dark' ? 'Light' : 'Dark'}
          </Button>
        </SettingRow>
      </div>

      <div>
        <SectionLabel>Accent color</SectionLabel>
        <div className="rounded-lg border border-border-soft bg-card p-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-2.5">
            {ACCENT_PRESETS.map(p => {
              const active = activePresetId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  onClick={() => changeAccent({ h: p.h, c: p.c })}
                  className={cn(
                    'size-8 rounded-full transition-transform',
                    active
                      ? 'ring-2 ring-offset-2 ring-offset-card ring-foreground scale-105'
                      : 'hover:scale-105',
                  )}
                  style={{ background: `oklch(0.62 ${p.c} ${p.h})` }}
                />
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <Label className="shrink-0 text-xs">Custom hue</Label>
            <input
              type="range"
              min={0}
              max={360}
              value={Math.round(accent.h)}
              onChange={e => changeAccent({ h: Number(e.target.value), c: 0.085 })}
              className="flex-1 accent-primary"
            />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(accent.h)}&deg;
            </span>
          </div>
          <HintText>Pick a preset or drag for a custom hue. Saved to this browser.</HintText>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render the tab body**

In the `PageBody` / `ContentColumn`, after the Memory block (the `{tab === 'memory' && (...)}` block ends at line ~767) and before the Account block (`{tab === 'account' && ...}` at line ~770), insert:
```tsx
          {/* ── Appearance ─────────────────────────────── */}
          {tab === 'appearance' && <AppearanceSettings />}

```

- [ ] **Step 5: Verify the build / types**

Run:
```bash
cd web && npx tsc -b
```
Expected: no type errors.

- [ ] **Step 6: Run the full unit suite**

Run:
```bash
cd web && npm test
```
Expected: all tests pass (including `accent.test.ts` and the existing `Settings.test.tsx`). If `Settings.test.tsx` asserts on the tab list, update it to include "Appearance" — do not change unrelated assertions.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/Settings.tsx
git commit -m "feat(web): Settings Appearance tab with theme + accent picker"
```

---

### Task 8: Visual verification with Playwright

This task produces no code — it verifies the restyle and accent behavior in a real browser using the Playwright MCP browser tools, and captures after-screenshots to compare against the existing before-screenshots (`webui-*.png` at repo root, captured 2026-06-20).

**Files:**
- None (verification only). Save screenshots under `screenshots/restyle-*`.

- [ ] **Step 1: Start the stack**

Run the backend and web dev server (background):
```bash
cd web && npm run dev
```
Note the dev URL (Vite, typically `http://localhost:5174`). Ensure the API server on `:3000` is running too (see repo `README.md` / `docker-compose.yml`).

- [ ] **Step 2: Capture the key screens**

Using the Playwright MCP browser tools, navigate to the dev URL (reuse an existing auth token in localStorage if the app requires login — same session used for the before-shots) and screenshot, at desktop (1280×800) and mobile (390×844) widths:
- Login, Chats (empty + loaded), Projects, Project detail, Settings (Agents + Appearance), Chat with a code block + Context panel.

Confirm against the before-shots:
- Font is Inter everywhere (no Hanken).
- No full-pill buttons/chips; "New chat" + header chips read as rounded-rects; status/tag chips are rounded-md.
- Avatars, status dots, notification badges, progress bars, scrollbar thumb are still circular/round.
- No layout regressions (no clipping, overflow, or broken spacing).

- [ ] **Step 3: Verify the accent is live and parametrized**

In Settings → Appearance, click the **Green** preset, then evaluate in the page:
```js
const cs = getComputedStyle(document.documentElement);
({ h: cs.getPropertyValue('--accent-h').trim(), c: cs.getPropertyValue('--accent-c').trim() });
```
Expected: `{ h: "152", c: "0.085" }`. Confirm the sidebar "New chat" button + active nav recolor immediately. Screenshot. Then drag the custom hue slider to ~20 and confirm `--accent-h` becomes `20` and the UI recolors.

- [ ] **Step 4: Verify persistence + both themes**

Reload the page; confirm the chosen accent persists (no flash of blue on load). Toggle Light/Dark in Appearance and confirm the accent holds and contrast looks fine in both. Reset to **Blue** and confirm it matches the original look.

- [ ] **Step 5: Final full test run**

Run:
```bash
cd web && npm test && npx tsc -b
```
Expected: all green, no type errors.

- [ ] **Step 6: Commit any saved screenshots**

```bash
git add screenshots/restyle-*
git commit -m "test(web): visual verification screenshots for restyle + accent"
```

---

## Notes for the implementer

- The radius scale is fully calc-derived from `--radius`; resist editing individual `rounded-*` classes for sizing — change only the base token (Task 2) and the 5 enumerated chip pills (Task 3).
- The accent var fallbacks (`var(--accent-h, 252)` / `var(--accent-c, 0.085|0.1)`) mean the app renders correctly even with JS disabled or before the inline script runs — the default is baked into the fallback.
- One chroma value applies to both light and dark when a user picks a non-default accent (a deliberate simplification); the per-mode default chroma is preserved only when no override is set.
- iOS is out of scope this round; the `{h, c}` storage shape is intentionally simple so a later iOS pass can map it to `tintColor`.
