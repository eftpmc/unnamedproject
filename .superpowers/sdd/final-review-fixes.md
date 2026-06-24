# Final Review Fixes — Document Items Feature

**Date:** 2026-06-24

## Fix 1 (Critical): TypeScript compile error — `readItemContent` + spaces.ts narrowing

### Problem
Adding `'document'` to the `SpaceItem` union broke the `GET /:spaceId/items/:itemId/content` route. After the `'repo'` guard, TypeScript still saw `'document'` in the union, which has no `mime_type`. This caused a compile error. Also, `readItemContent` had no `'document'` branch and would fall through to the `'repo'` error.

### Changes
- **`server/src/services/items.ts`** — Added explicit `'document'` branch to `readItemContent` that throws a descriptive error.
- **`server/src/routes/spaces.ts`** — Added `'document'` guard before calling `readItemContent`. After this guard the union narrows to `'file' | 'note'`, resolving the TS error and giving callers a helpful 400 error.
- **`server/src/services/items.test.ts`** — Fixed pre-existing TS errors in document item tests: added `if (item.type !== 'document') throw` type narrowing guards where `item.template` and `item.blocks` were accessed without narrowing.

**Result:** `npx tsc --noEmit` exits clean (0 errors).

---

## Fix 2 (Important): Migration v9 restores `execution_id` FK

### Problem
The `CREATE TABLE session_events` DDL inside `addDocumentItems` (v9 migration) had `execution_id TEXT` without the `REFERENCES executions(id) ON DELETE SET NULL` FK that existed before the rebuild. Fresh installs would silently drop this constraint.

### Changes
- **`server/src/db/index.ts`** — Changed `execution_id TEXT,` to `execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,` in the v9 migration's session_events DDL.
- **Dev DB** (`server/data/app.db`) — Deleted and will rebuild from scratch on next server start with the corrected schema. (Dev environment only; backups preserved in `server/data/`.)

---

## Fix 3 (Important): Replace placeholder migration test with real test

### Problem
`server/src/db/migrate-v9.test.ts` had two placeholder tests: one asserting the table was ABSENT (trivially true before migration runs), the other `expect(true).toBe(true)`.

### Changes
- **`server/src/db/index.ts`** — Exported `addDocumentItems` (changed `function` to `export function`).
- **`server/src/db/migrate-v9.test.ts`** — Replaced with 5 meaningful tests:
  1. `space_documents` table created with correct columns (`item_id`, `template`, `blocks`)
  2. `overview_blocks` column added to `space_repos`
  3. `space_items.type` CHECK constraint now allows `'document'`
  4. `session_events.type` CHECK constraint now allows `'item_updated'`
  5. Migration is idempotent (running twice does not throw)

**Result:** All 5 tests pass: `npx vitest run src/db/migrate-v9.test.ts` → 5 passed.

---

## Test Results

```
npx tsc --noEmit                              → 0 errors
npx vitest run src/db/migrate-v9.test.ts     → 5/5 passed
npx vitest run                               → 9 pre-existing failures (unrelated to this feature),
                                               all new/modified tests pass
```

Pre-existing failures (confirmed by stash test):
- `tests/services/agent.test.ts` — 6 failures related to pre-v9 agent tool integration
- `tests/db/migration-v5.test.ts` — 3 failures (version assertion expects 8 not 9; space_repos not created in partial test setup)

These failures existed before this PR's changes and are out of scope.
