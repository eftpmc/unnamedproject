# Remotion Video Generation Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent render MP4 videos via Remotion through a `generate_video` tool, store them under `data/projects/<id>/media/`, serve them over HTTP, and preview them in the project UI via a "Studio" tab (the `'video'` project type from the project-type-architecture plan).

**Architecture:** A standalone `remotion/` composition project bundled once and cached by `server/src/services/video.ts`. `generate_video` creates an async `executions` row, renders in the background, and completes the execution when done. New `/projects/:id/media` routes list/serve files (with a query-token auth fallback for `<video src>`). `FileBrowser` gains media-kind detection; a new `StudioTab` lists rendered videos.

**Tech Stack:** Remotion (`remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/cli`), Express, React 19, Vitest

**Prerequisite:** `docs/superpowers/plans/2026-06-12-project-type-architecture.md` must be implemented first (provides `PROJECT_TYPES`, `isValidProjectType`, `PROJECT_TYPE_REGISTRY`, `Project.type`).

---

### Task 1: Scaffold the Remotion composition project

**Files:**
- Create: `remotion/package.json`
- Create: `remotion/tsconfig.json`
- Create: `remotion/src/index.ts`
- Create: `remotion/src/Scenes.tsx`
- Create: `remotion/remotion.config.ts`

- [ ] **Step 1: Create `remotion/package.json`**

```json
{
  "name": "remotion-templates",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "preview": "remotion studio src/index.ts"
  },
  "dependencies": {
    "@remotion/bundler": "^4.0.290",
    "@remotion/cli": "^4.0.290",
    "@remotion/renderer": "^4.0.290",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "remotion": "^4.0.290"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.5.3"
  }
}
```

- [ ] **Step 2: Create `remotion/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `remotion/remotion.config.ts`**

```ts
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
```

- [ ] **Step 4: Create `remotion/src/Scenes.tsx`**

```tsx
import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, Img } from 'remotion';

export interface VideoScene {
  text: string;
  durationInSeconds: number;
  imageUrl?: string;
}

export interface ScenesProps {
  title: string;
  scenes: VideoScene[];
}

function Scene({ scene }: { scene: VideoScene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps / 2], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' }}>
      {scene.imageUrl && (
        <Img src={scene.imageUrl} style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
      )}
      <div style={{ opacity, color: 'white', fontSize: 64, fontFamily: 'sans-serif', textAlign: 'center', padding: '0 80px', zIndex: 1 }}>
        {scene.text}
      </div>
    </AbsoluteFill>
  );
}

export function Scenes({ scenes }: ScenesProps) {
  const { fps } = useVideoConfig();
  let startFrame = 0;
  return (
    <AbsoluteFill>
      {scenes.map((scene, i) => {
        const durationInFrames = Math.round(scene.durationInSeconds * fps);
        const from = startFrame;
        startFrame += durationInFrames;
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <Scene scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

export function calculateScenesDuration(scenes: VideoScene[], fps: number): number {
  return scenes.reduce((sum, s) => sum + Math.round(s.durationInSeconds * fps), 0);
}
```

- [ ] **Step 5: Create `remotion/src/index.ts`**

```tsx
import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Scenes, calculateScenesDuration, type ScenesProps } from './Scenes.js';

const defaultProps: ScenesProps = {
  title: 'Untitled',
  scenes: [{ text: 'Hello world', durationInSeconds: 3 }],
};

const fps = 30;

function RemotionRoot() {
  return (
    <Composition
      id="Scenes"
      component={Scenes}
      durationInFrames={calculateScenesDuration(defaultProps.scenes, fps)}
      fps={fps}
      width={1280}
      height={720}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: calculateScenesDuration(props.scenes, fps),
      })}
    />
  );
}

registerRoot(RemotionRoot);
```

- [ ] **Step 6: Install and verify**

Run: `npm install --prefix remotion`
Then: `npx --prefix remotion remotion render src/index.ts Scenes /tmp/test-scenes.mp4`
Expected: an MP4 is written to `/tmp/test-scenes.mp4` showing "Hello world" for 3 seconds.

- [ ] **Step 7: Commit**

```bash
git add remotion/
git commit -m "feat: scaffold remotion video composition project"
```

---

### Task 2: Server-side render service

**Files:**
- Modify: `server/package.json`
- Create: `server/src/services/video.ts`
- Test: `server/src/services/video.test.ts`

- [ ] **Step 1: Add dependencies to `server/package.json`**

Add to `dependencies`:

```json
"@remotion/bundler": "^4.0.290",
"@remotion/renderer": "^4.0.290"
```

Run: `npm install --prefix server`

- [ ] **Step 2: Write a failing test for scene-duration math** (the one piece of logic worth unit testing without invoking a real render)

```ts
import { describe, it, expect } from 'vitest';
import { buildMediaPath } from './video.js';

describe('buildMediaPath', () => {
  it('builds a path under data/projects/<id>/media with a sanitized filename', () => {
    const p = buildMediaPath('proj-1', 'My Cool Video!');
    expect(p.dir).toContain('data/projects/proj-1/media');
    expect(p.fileName).toMatch(/^\d+-my-cool-video-\.mp4$/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --prefix server -- video`
Expected: FAIL — "Cannot find module './video.js'"

- [ ] **Step 4: Implement `server/src/services/video.ts`**

```ts
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDataDir } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface VideoScene {
  text: string;
  durationInSeconds: number;
  imageUrl?: string;
}

let bundleLocationPromise: Promise<string> | null = null;

function getBundle(): Promise<string> {
  if (!bundleLocationPromise) {
    bundleLocationPromise = bundle({
      entryPoint: path.resolve(__dirname, '../../../remotion/src/index.ts'),
    });
  }
  return bundleLocationPromise;
}

export function buildMediaPath(projectId: string, title: string): { dir: string; fileName: string } {
  const dir = path.join(getDataDir(), 'projects', projectId, 'media');
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  const fileName = `${Date.now()}-${slug || 'video'}.mp4`;
  return { dir, fileName };
}

export async function renderVideo(
  projectId: string,
  title: string,
  scenes: VideoScene[],
  onProgress?: (progress: number) => void,
): Promise<string> {
  const serveUrl = await getBundle();
  const inputProps = { title, scenes };

  const composition = await selectComposition({ serveUrl, id: 'Scenes', inputProps });

  const { dir, fileName } = buildMediaPath(projectId, title);
  fs.mkdirSync(dir, { recursive: true });
  const outputLocation = path.join(dir, fileName);

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation,
    inputProps,
    onProgress: ({ progress }) => onProgress?.(progress),
  });

  return fileName;
}
```

Check `server/src/db/index.ts` for `getDataDir` — confirm its export signature (used elsewhere e.g. `server/src/routes/projects.ts:48`) and import it correctly; it returns the root data directory (so media lands at `<dataDir>/projects/<id>/media`, separate from the existing `<dataDir>/doc-projects/<id>/files` used for non-repo code projects).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix server -- video`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/services/video.ts server/src/services/video.test.ts
git commit -m "feat: add remotion-backed video render service"
```

---

### Task 3: Media list/serve routes with query-token auth

**Files:**
- Modify: `server/src/middleware/auth.ts`
- Modify: `server/src/routes/projects.ts`
- Test: `server/src/routes/projects.test.ts` (create if it doesn't exist — check first)

- [ ] **Step 1: Add query-token fallback to auth middleware**

`<video src>`/`<img src>` tags can't send `Authorization` headers, so the media routes need to accept the JWT as a `?token=` query param. Add a new middleware alongside `requireAuth` in `server/src/middleware/auth.ts`:

```ts
export function requireAuthHeaderOrQuery(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  try {
    const payload = verifyToken(token);
    (req as AuthedRequest).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

- [ ] **Step 2: Write failing tests for the media routes**

First check whether `server/src/routes/projects.test.ts` exists; if other route test files exist (`ls server/src/routes/*.test.ts`), mirror their supertest/app-setup pattern. Add:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
// import whatever test app/request helper existing route tests use, e.g.:
// import { app } from '../test-helpers.js';

describe('GET /projects/:id/media', () => {
  it('returns an empty list when no media dir exists', async () => {
    // const res = await request(app).get(`/api/projects/${projectId}/media`).set('Authorization', `Bearer ${token}`);
    // expect(res.status).toBe(200);
    // expect(res.body.files).toEqual([]);
  });

  it('lists files after one is written to the media dir', async () => {
    // write a dummy file under data/projects/<id>/media/test.mp4, then GET and assert it's listed
  });
});

describe('GET /projects/:id/media/:filename', () => {
  it('rejects path traversal attempts', async () => {
    // const res = await request(app).get(`/api/projects/${projectId}/media/..%2F..%2Fetc%2Fpasswd?token=${token}`);
    // expect(res.status).toBe(400);
  });

  it('serves an existing file with the right content-type', async () => {
    // expect res.headers['content-type'] to be 'video/mp4'
  });

  it('accepts auth via ?token= query param', async () => {
    // request without Authorization header, with ?token=<jwt>, expect 200
  });
});
```

Fill in the commented-out bodies using the exact helper/setup pattern from an existing `server/src/routes/*.test.ts` file (project test infra — in-memory DB, test user, JWT helper). This step's deliverable is a complete, runnable test file, not the skeleton above.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test --prefix server -- projects`
Expected: FAIL — routes don't exist yet (404s)

- [ ] **Step 4: Implement the routes**

In `server/src/routes/projects.ts`, add after the `/:id/file` route (after line 105):

```ts
const MEDIA_CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

function getMediaDir(projectId: string): string {
  return path.join(getDataDir(), 'projects', projectId, 'media');
}

router.get('/:id/media', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string } | undefined;
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const dir = getMediaDir(req.params.id);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.filter(e => e.isFile()).map(async e => {
        const stat = await fs.stat(path.join(dir, e.name));
        return {
          name: e.name,
          url: `/api/projects/${req.params.id}/media/${encodeURIComponent(e.name)}`,
          createdAt: Math.floor(stat.birthtimeMs),
        };
      })
    );
    files.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});

router.get('/:id/media/:filename', requireAuthHeaderOrQuery, async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string } | undefined;
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }

  const filename = req.params.filename;
  if (filename.includes('/') || filename.includes('..')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const filePath = path.join(getMediaDir(req.params.id), filename);
  try {
    await fs.access(filePath);
  } catch {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  res.setHeader('Content-Type', MEDIA_CONTENT_TYPES[ext] ?? 'application/octet-stream');
  res.sendFile(filePath);
});
```

Notes:
- `router.use(requireAuth)` (line 9) already applies `requireAuth` to all routes in this file, which would reject query-token-only requests with no `Authorization` header before reaching the route handler. The `/:id/media/:filename` route needs the query-token fallback — since Express runs router-level middleware first, either (a) move the per-file route to a *new* router mounted before `requireAuth` is applied with `requireAuthHeaderOrQuery` instead, or (b) make `requireAuth` itself check the query param fallback only for this one path. Simplest: extract the media-file route into its own `Router` in the same file, mounted in `server/src/index.ts` (or wherever `projects` router is mounted) at the same base path *before* the main `projects` router, using `requireAuthHeaderOrQuery`. Check `server/src/index.ts` for how `projects` router is currently mounted and add the new router alongside it with matching path prefix.
- `res.sendFile` requires an absolute path — `path.join(getMediaDir(...), filename)` is already absolute since `getDataDir()` returns an absolute path; confirm this against `getDataDir`'s implementation.
- Add `import fs from 'fs'` is wrong — file already imports `fs from 'fs/promises'` (line 2) which lacks `sendFile`'s sync needs; `res.sendFile` is an Express `Response` method and doesn't need a separate `fs` import, but `fs.access`/`fs.readdir`/`fs.stat` above use the existing `fs/promises` import — fine as-is.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix server -- projects`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/middleware/auth.ts server/src/routes/projects.ts server/src/routes/projects.test.ts server/src/index.ts
git commit -m "feat: add media list/serve routes for project media files"
```

---

### Task 4: `generate_video` tool — definition and async dispatch

**Files:**
- Modify: `server/src/tools/definitions.ts`
- Modify: `server/src/services/context.ts`
- Modify: `server/src/services/agent.ts`

- [ ] **Step 1: Add the tool definition**

In `server/src/tools/definitions.ts`, append to `toolDefinitions`:

```ts
{
  name: 'generate_video',
  description: "Render an MP4 video for a project from structured scene data using Remotion. Runs asynchronously — returns immediately with an execution id, and the rendered video will appear in the project's Studio tab when done. Best used with video-type projects.",
  input_schema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: 'ID of the project (should be a video-type project)' },
      title: { type: 'string', description: 'Video title, also used to name the output file' },
      scenes: {
        type: 'array',
        description: 'Ordered list of scenes to render, played back to back',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to display during this scene' },
            durationInSeconds: { type: 'number', description: 'How long this scene lasts, in seconds' },
            imageUrl: { type: 'string', description: 'Optional background image URL for this scene' },
          },
          required: ['text', 'durationInSeconds'],
        },
      },
    },
    required: ['project_id', 'title', 'scenes'],
  },
},
```

- [ ] **Step 2: Add to the `creative` tool set**

In `server/src/services/context.ts`, add `'generate_video'` to `TOOL_SETS.creative` (around line 196-198):

```ts
creative: [
  'write_file', 'read_file', 'create_project', 'generate_video',
  'web_search', 'web_fetch', 'remember', 'recall', 'forget', 'read_chat',
],
```

- [ ] **Step 3: Add the dispatch case**

In `server/src/services/agent.ts`:

Add the import near the top (alongside other tool imports, e.g. near line 17):

```ts
import { renderVideo, type VideoScene } from './video.js';
import { appendOutput } from './executor.js';
```

(Check `appendOutput`'s actual export location — it was reported as part of `server/src/services/executor.ts`; if `agent.ts` already imports from `./executor.js`, add `appendOutput` to that existing import instead of a new one.)

Add the case inside the `switch (toolName)` block (alongside `case 'create_project':` etc.):

```ts
case 'generate_video': {
  const title = toolInput.title as string;
  const scenes = toolInput.scenes as VideoScene[];

  renderVideo(projectId, title, scenes, (progress) => {
    appendOutput(executionId, userId, `progress: ${Math.round(progress * 100)}%\n`);
  })
    .then((fileName) => completeExecution(executionId, userId, 'done', `Rendered ${fileName}`))
    .catch((err) => completeExecution(executionId, userId, 'error', err instanceof Error ? err.message : String(err)));

  result = `Video render started (execution ${executionId}). It will appear in the project's Studio tab when done.`;
  asyncExecution = true;
  break;
}
```

- [ ] **Step 4: Prevent double-completion of the execution**

The surrounding `try` block (reported structure, around lines 114-336) calls `completeExecution(executionId, userId, 'done', result)` after the switch for *every* tool — but `generate_video` already completes its own execution asynchronously via `.then`/`.catch` above. Introduce a flag:

Before the `switch`, declare:

```ts
let asyncExecution = false;
```

After the `switch`, change the unconditional completion call to:

```ts
if (!asyncExecution) {
  completeExecution(executionId, userId, 'done', result);
}
return result;
```

Apply the same guard to the `catch` block's `completeExecution(executionId, userId, 'error', msg)` call — wrap it in `if (!asyncExecution)` too, in case `renderVideo(...)` throws synchronously before returning its promise (unlikely but cheap to guard).

- [ ] **Step 5: Build and smoke-test**

Run: `npm run build --prefix server`
Expected: succeeds.

Manual smoke test (requires a running server + a video-type project from the prior plan): call `generate_video` with a 2-scene payload, confirm the execution appears as `running` then `done`, and `data/projects/<id>/media/` contains an `.mp4`.

- [ ] **Step 6: Commit**

```bash
git add server/src/tools/definitions.ts server/src/services/context.ts server/src/services/agent.ts
git commit -m "feat: add generate_video tool with async execution"
```

---

### Task 5: Media-aware FileBrowser + API helpers

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/FileBrowser.tsx`
- Test: `web/src/components/FileBrowser.test.tsx` (create)

- [ ] **Step 1: Add API helpers**

In `web/src/lib/api.ts`, after `getProjectFile` (around line 110):

```ts
export interface ProjectMediaFile {
  name: string;
  url: string;
  createdAt: number;
}

export function getProjectMedia(projectId: string): Promise<{ files: ProjectMediaFile[] }> {
  return request(`/projects/${projectId}/media`);
}

export function mediaFileUrl(projectId: string, filename: string): string {
  const token = getToken();
  const base = `/api/projects/${projectId}/media/${encodeURIComponent(filename)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
```

Check the `request` function's base URL handling (line ~4-15) — confirm whether it prefixes `/api` itself or callers include it; adjust `mediaFileUrl`'s `/api/projects/...` prefix to match how other absolute URLs are built in this file (e.g. check if there's an existing `API_BASE` constant to reuse).

- [ ] **Step 2: Write failing test for `detectFileKind`**

```tsx
import { describe, it, expect } from 'vitest';
import { detectFileKind } from './FileBrowser.js';

describe('detectFileKind', () => {
  it('detects images', () => {
    expect(detectFileKind('foo/bar.png')).toBe('image');
    expect(detectFileKind('a.jpg')).toBe('image');
  });
  it('detects video', () => {
    expect(detectFileKind('clip.mp4')).toBe('video');
  });
  it('detects audio', () => {
    expect(detectFileKind('voice.mp3')).toBe('audio');
  });
  it('defaults to text', () => {
    expect(detectFileKind('readme.md')).toBe('text');
    expect(detectFileKind('script.ts')).toBe('text');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --prefix web -- FileBrowser`
Expected: FAIL — `detectFileKind` not exported

- [ ] **Step 4: Implement `detectFileKind` and wire it into the viewer**

In `web/src/components/FileBrowser.tsx`, export a new function near `detectLanguage` (after line 87):

```ts
export function detectFileKind(filePath: string): 'image' | 'video' | 'audio' | 'text' {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio';
  return 'text';
}
```

This is exported so it can be reused by `StudioTab` (Task 6) for consistent kind-detection, and so it's directly testable.

Note: this function classifies by extension only. `FileBrowser`'s existing tree (`getProjectTree`/`getProjectFile`) is for the project's repo/doc files — media generated by `generate_video` lives in a separate `media/` directory not exposed via `getProjectTree`. So `detectFileKind` in `FileBrowser` is for future-proofing (e.g. if a code project's repo contains an image asset) but the primary media browsing UX is `StudioTab` (Task 6), which uses `mediaFileUrl` directly. Do not change `FileBrowser`'s data source in this task — just add the exported helper and, for completeness, a non-text branch in the viewer:

After the `isMd`/else viewer branches (lines 158-167), before them, add:

```tsx
{fileData && detectFileKind(selectedPath!) === 'image' && (
  <div className="flex items-center justify-center p-4">
    <img src={`data:image;base64,${fileData.content}`} alt={selectedPath!} className="max-w-full" />
  </div>
)}
```

Wait — `getProjectFile` returns `{ content: string }` from `fs.readFile(target, 'utf-8')` (server route, line 100), which corrupts binary data. Rendering repo-tree images is out of scope for this task (would require changing the `/file` route to base64-encode binary files, which is a larger change not needed for the video feature). **Skip the repo-tree image rendering** — only add the exported `detectFileKind` function (Step 4 above, just the function, no viewer changes in `FileBrowser`). The actual media preview UX is entirely in `StudioTab` (Task 6), which fetches from the dedicated `/media` routes that serve raw bytes correctly.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix web -- FileBrowser`
Expected: PASS (4 tests, `detectFileKind` exported with no other `FileBrowser` behavior changes)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/api.ts web/src/components/FileBrowser.tsx web/src/components/FileBrowser.test.tsx
git commit -m "feat: add media API helpers and detectFileKind"
```

---

### Task 6: `'video'` project type + Studio tab

**Files:**
- Modify: `server/src/services/projectTypes.ts`
- Create: `web/src/components/StudioTab.tsx`
- Modify: `web/src/projectTypes.tsx`
- Test: `web/src/components/StudioTab.test.tsx`

- [ ] **Step 1: Confirm `'video'` is already in `PROJECT_TYPES`**

`server/src/services/projectTypes.ts` should already have `PROJECT_TYPES = ['default', 'video']` from the prior plan (Task 2). If not, add `'video'` now.

- [ ] **Step 2: Write failing test for `StudioTab`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudioTab from './StudioTab.js';
import type { Project } from '../types.js';

vi.mock('../lib/api.js', () => ({
  getProjectMedia: vi.fn(),
  mediaFileUrl: (projectId: string, filename: string) => `/api/projects/${projectId}/media/${filename}`,
}));

import { getProjectMedia } from '../lib/api.js';

const project: Project = {
  id: 'proj-1', name: 'Vid Project', description: null, repo_path: null,
  enabled_connection_ids: [], type: 'video',
};

function renderTab() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <StudioTab project={project} />
    </QueryClientProvider>
  );
}

describe('StudioTab', () => {
  it('shows empty state when no videos exist', async () => {
    (getProjectMedia as any).mockResolvedValue({ files: [] });
    renderTab();
    expect(await screen.findByText(/no videos yet/i)).toBeInTheDocument();
  });

  it('renders a video element for each file', async () => {
    (getProjectMedia as any).mockResolvedValue({
      files: [{ name: 'clip.mp4', url: '/api/projects/proj-1/media/clip.mp4', createdAt: 1700000000000 }],
    });
    renderTab();
    expect(await screen.findByText('clip.mp4')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --prefix web -- StudioTab`
Expected: FAIL — "Cannot find module './StudioTab.js'"

- [ ] **Step 4: Implement `StudioTab`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { getProjectMedia, mediaFileUrl } from '../lib/api.js';
import { EmptyPanel, Surface } from '@/components/ui/app-layout';
import type { Project } from '../types.js';

export default function StudioTab({ project }: { project: Project }) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-media', project.id],
    queryFn: () => getProjectMedia(project.id),
    staleTime: 10000,
  });

  const files = data?.files ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={14} className="animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <EmptyPanel
        title="No videos yet"
        description="Ask the agent to generate one for this project."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {files.map(f => (
        <Surface key={f.name} className="p-3">
          <video controls src={mediaFileUrl(project.id, f.name)} className="w-full rounded" />
          <div className="mt-2 truncate text-xs text-muted-foreground">{f.name}</div>
        </Surface>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix web -- StudioTab`
Expected: PASS (2 tests)

- [ ] **Step 6: Register the `'video'` project type**

In `web/src/projectTypes.tsx`, update `PROJECT_TYPE_REGISTRY`:

```tsx
import StudioTab from './components/StudioTab.js';

export const PROJECT_TYPE_REGISTRY: Record<string, ProjectTypeConfig> = {
  default: {
    extraTabs: [],
  },
  video: {
    extraTabs: [{ id: 'studio', label: 'Studio', component: StudioTab }],
  },
};
```

- [ ] **Step 7: Run full web test suite**

Run: `npm test --prefix web`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add web/src/components/StudioTab.tsx web/src/components/StudioTab.test.tsx web/src/projectTypes.tsx server/src/services/projectTypes.ts
git commit -m "feat: add video project type with Studio tab"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Full build + test, all packages**

Run: `npm run build --prefix server && npm run build --prefix web && npm test --prefix server && npm test --prefix web`
Expected: all PASS

- [ ] **Step 2: Manual end-to-end check**

1. Start the dev server (`npm run dev`).
2. Create a project with `type: 'video'` (via the `create_project` tool from a chat, or directly if there's a UI for it).
3. Confirm the project page shows a "Studio" tab (empty state).
4. Call `generate_video` with `project_id`, a `title`, and 2 scenes (e.g. `[{text: "Hello", durationInSeconds: 2}, {text: "World", durationInSeconds: 2}]`).
5. Watch the execution go `running` → `done`.
6. Reload the Studio tab — confirm the rendered MP4 appears with a working `<video>` preview that plays.

- [ ] **Step 3: Note any first-run setup**

If `@remotion/renderer`'s `ensureBrowser()`/Chromium download is needed and not automatic on first `renderMedia` call, document the one-time setup command in `remotion/README.md` or the root `README.md` (e.g. `npx remotion browser ensure`).
