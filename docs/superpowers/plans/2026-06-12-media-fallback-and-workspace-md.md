# Media Fallback & Workspace.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Make `has_media` detect pre-existing rendered videos in `<repo_path>/out/*.mp4` so projects that rendered before the new media path convention still surface the Studio tab; (2) add a `workspace.md` living-context file that the orchestrator reads at session start and is instructed to maintain, giving it persistent memory of a project's current state.

**Architecture:** Task 1 is a pure server change — `detectCapabilities` gains an optional `repoPath` param and a fallback `out/` scan; two call sites (`routes/projects.ts` and `services/context.ts`) pass `repo_path` through. Task 2 is also server-only — `context.ts` grows a `readWorkspaceMd` helper that reads `workspace.md` from the project's file root; `projectContextBlock` injects its content (or an instructive hint) into the orchestrator system prompt.

**Tech Stack:** TypeScript, Node.js `fs` (sync), better-sqlite3, vitest

---

## File Map

| File | Change |
|---|---|
| `server/src/services/projectCapabilities.ts` | Add `repoPath` param; fallback `out/` scan |
| `server/src/services/projectCapabilities.test.ts` | Tests for new fallback logic |
| `server/src/routes/projects.ts` | Pass `repo_path` to `detectCapabilities` in capabilities endpoint |
| `server/src/services/context.ts` | Add `fs`/`path` imports, `getDataDir`; add `readWorkspaceMd`; update `projectContextBlock` |
| `server/tests/services/context.test.ts` | Tests for workspace.md inclusion |

---

### Task 1: `has_media` fallback — scan `<repo_path>/out/` for `.mp4` files

**Files:**
- Modify: `server/src/services/projectCapabilities.ts`
- Modify: `server/src/services/projectCapabilities.test.ts`
- Modify: `server/src/routes/projects.ts:130-142`
- Modify: `server/src/services/context.ts:84`

**Background:** `detectCapabilities` currently checks `<dataDir>/projects/<id>/media/` for rendered files. Any video rendered before this convention (stored in the project repo's `out/` dir by Remotion's default) is invisible. The fix: if `has_media` is still false and `repoPath` is provided, scan `<repoPath>/out/` for `.mp4` files.

- [ ] **Step 1: Write the failing test for the `out/` fallback**

Add to `server/src/services/projectCapabilities.test.ts` after the existing `has_media is false when media dir is empty` test:

```typescript
it('has_media is true when repoPath/out/ has .mp4 files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-test-'));
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'scene.mp4'), 'fake');

  vi.doMock('../db/index.js', () => ({
    getDataDir: () => '/tmp/no-media-here',
  }));
  const { detectCapabilities } = await import('./projectCapabilities.js');
  const result = detectCapabilities('proj-5', tmpDir);
  expect(result.has_media).toBe(true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

it('has_media is false when repoPath/out/ has no .mp4 files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-test-'));
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'composition.js'), 'fake'); // not an mp4

  vi.doMock('../db/index.js', () => ({
    getDataDir: () => '/tmp/no-media-here',
  }));
  const { detectCapabilities } = await import('./projectCapabilities.js');
  const result = detectCapabilities('proj-6', tmpDir);
  expect(result.has_media).toBe(false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npx vitest run src/services/projectCapabilities.test.ts
```

Expected: 2 new tests FAIL (detectCapabilities only accepts 1 arg currently).

- [ ] **Step 3: Update `detectCapabilities` to accept `repoPath` and scan `out/`**

Replace the entire body of `server/src/services/projectCapabilities.ts` with:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDataDir } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProjectCapabilities {
  has_remotion: boolean;
  has_media: boolean;
}

export function detectCapabilities(projectId: string, repoPath?: string | null): ProjectCapabilities {
  // has_remotion: server-level — Remotion is a global composition, not per-project
  const remotionEntry = path.resolve(__dirname, '../../../remotion/src/index.tsx');
  const has_remotion = fs.existsSync(remotionEntry);

  // has_media: per-project — check new data-dir path first, then repo out/ as fallback
  const mediaDir = path.join(getDataDir(), 'projects', projectId, 'media');
  let has_media = fs.existsSync(mediaDir) && fs.readdirSync(mediaDir).length > 0;

  if (!has_media && repoPath) {
    const outDir = path.join(repoPath, 'out');
    has_media = fs.existsSync(outDir) && fs.readdirSync(outDir).some(f => f.endsWith('.mp4'));
  }

  return { has_remotion, has_media };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npx vitest run src/services/projectCapabilities.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Update capabilities endpoint in `server/src/routes/projects.ts`**

Find the capabilities endpoint (line ~130):

```typescript
router.get('/:id/capabilities', requireAuthHeaderOrQuery, (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string } | undefined;

  if (!project) {
    res.status(404).json({ error: 'project not found' });
    return;
  }

  res.json(detectCapabilities(project.id));
});
```

Replace with:

```typescript
router.get('/:id/capabilities', requireAuthHeaderOrQuery, (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id, repo_path FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; repo_path: string | null } | undefined;

  if (!project) {
    res.status(404).json({ error: 'project not found' });
    return;
  }

  res.json(detectCapabilities(project.id, project.repo_path));
});
```

- [ ] **Step 6: Update `detectCapabilities` call in `server/src/services/context.ts`**

Find line ~84:

```typescript
const caps = detectCapabilities(project.id);
```

Replace with:

```typescript
const caps = detectCapabilities(project.id, project.repo_path);
```

- [ ] **Step 7: Run full server test suite to confirm no regressions**

```bash
cd server && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/projectCapabilities.ts \
        server/src/services/projectCapabilities.test.ts \
        server/src/routes/projects.ts \
        server/src/services/context.ts
git commit -m "feat: has_media fallback scans repo out/ for pre-existing .mp4 files"
```

---

### Task 2: `workspace.md` — living project context for the orchestrator

**Files:**
- Modify: `server/src/services/context.ts`
- Modify: `server/tests/services/context.test.ts`

**Background:** The orchestrator builds its system prompt fresh each session with no memory of what's been accomplished in a project. Adding a `workspace.md` file — read from the project root at session start — lets past work persist as context. The orchestrator is instructed to create and maintain this file.

File locations:
- Repo project: `<repo_path>/workspace.md`
- Doc project: `<dataDir>/doc-projects/<id>/files/workspace.md` (same root `write_file` uses for doc projects)

- [ ] **Step 1: Write failing tests for workspace.md inclusion**

Add to `server/tests/services/context.test.ts` inside the `describe('buildContext', ...)` block, after the last existing test:

```typescript
it('includes workspace.md content in project context when file exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
  const workspaceContent = '## Goals\n- Build the login flow\n\n## Done\n- DB schema migration';
  fs.writeFileSync(path.join(tmpDir, 'workspace.md'), workspaceContent);

  const projectId = newId();
  getDb()
    .prepare('INSERT INTO projects (id, user_id, name, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?)')
    .run(projectId, userId, 'ws-project', tmpDir, '[]');
  getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

  const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
  expect(ctx).toContain('Build the login flow');
  expect(ctx).toContain('DB schema migration');

  getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

it('includes workspace.md hint when no file exists', () => {
  const projectId = newId();
  getDb()
    .prepare('INSERT INTO projects (id, user_id, name, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?)')
    .run(projectId, userId, 'no-ws-project', '/tmp/nonexistent-repo-path', '[]');
  getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

  const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
  expect(ctx).toContain('workspace.md');

  getDb().prepare('UPDATE sessions SET pinned_project_id = NULL WHERE id = ?').run(sessionId);
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(projectId);
});
```

Also add these two imports to the top of `server/tests/services/context.test.ts` (after the existing `import fs from 'fs'` line):

```typescript
import os from 'os';
import path from 'path';
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npx vitest run tests/services/context.test.ts
```

Expected: 2 new tests FAIL.

- [ ] **Step 3: Add `fs`, `path`, and `getDataDir` imports to `context.ts`**

At the top of `server/src/services/context.ts`, add after the existing imports:

```typescript
import fs from 'fs';
import path from 'path';
```

And update the `db/index.js` import line to include `getDataDir`:

```typescript
import { getDb, getAgentBudgets, getMonthlyUsage, getDataDir, type DbProject } from '../db/index.js';
```

- [ ] **Step 4: Add `readWorkspaceMd` helper to `context.ts`**

Add this function after the `// ─── Block builders` comment, before `baseBlock`:

```typescript
function readWorkspaceMd(project: DbProject): string | null {
  const filePath = project.repo_path
    ? path.join(project.repo_path, 'workspace.md')
    : path.join(getDataDir(), 'doc-projects', project.id, 'files', 'workspace.md');
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    return content || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Update `projectContextBlock` to inject workspace.md**

Find `projectContextBlock` in `context.ts`. Replace the final `return header + guidance;` with:

```typescript
  const workspaceMd = readWorkspaceMd(project);
  const workspaceSection = workspaceMd
    ? `\n\n### workspace.md\n${workspaceMd}\n\n_Update workspace.md after significant progress, decisions, or completed milestones._`
    : `\n\n_No workspace.md yet. Use write_file to create workspace.md in the project root to record current goals, decisions, and progress for future sessions._`;

  return header + guidance + workspaceSection;
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd server && npx vitest run tests/services/context.test.ts
```

Expected: all tests PASS including the 2 new ones.

- [ ] **Step 7: Run full server test suite**

```bash
cd server && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 8: Run full project test suite (server + web)**

```bash
npm test
```

Expected: all 258+ tests PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/context.ts \
        server/tests/services/context.test.ts
git commit -m "feat: inject workspace.md into orchestrator context for living project memory"
```
