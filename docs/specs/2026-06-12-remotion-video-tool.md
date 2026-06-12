# Spec: Remotion Video Generation Tool

## Problem

The agent has no way to produce video output. We want a tool the orchestrator can call with structured data (title/scenes/text) that renders an MP4 via Remotion, runs as a long-running async execution (using existing `executions` infrastructure), and surfaces the result as a previewable media file in the project — building on the `'video'` project type from the project-type-architecture spec.

## Goals

- A `remotion/` composition project (one generic template: title + sequence of text/image scenes) bundled once at server startup.
- A `generate_video` tool: input is `project_id` + structured scene data; output is an async execution that renders an MP4 to the project's media directory.
- Generated videos are stored under `data/projects/<project_id>/media/<file>.mp4`.
- A binary-serving HTTP endpoint for media files, and a media-aware `FileBrowser` viewer (`<video>`/`<img>`/`<audio>` tags).
- A `'video'` project type (registered per the project-type-architecture spec) with a "Studio" tab listing generated videos with inline preview.

## Non-goals

- Not building a visual storyboard/timeline editor — scenes are JSON in, MP4 out.
- Not supporting custom per-project Remotion compositions — one shared template, parametrized via `inputProps`.
- Not handling audio narration/TTS in this pass — `inputProps` schema allows an optional `audioUrl` per scene for future use, but the template doesn't need to play it yet... actually keep YAGNI: omit audio entirely, add later if needed.

## Design

### 1. Remotion composition project

New directory `remotion/` at repo root (sibling to `server/`, `web/`):
- `remotion/package.json` — deps: `remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/cli`, react/react-dom (peer).
- `remotion/src/index.ts` — `registerRoot`, registers one composition `"Scenes"`.
- `remotion/src/Scenes.tsx` — composition component. Props (the `inputProps` contract):

```ts
export interface ScenesProps {
  title: string;
  scenes: { text: string; durationInSeconds: number; imageUrl?: string }[];
}
```

Each scene becomes a `<Sequence>` of `durationInSeconds * fps` frames, rendering centered text (and background image if `imageUrl` given) with a simple fade-in via `interpolate`+`spring`. `durationInFrames` for the root composition = sum of scene durations * fps. `fps = 30`, `width = 1280`, `height = 720` (16:9, fixed for v1).

### 2. Server-side render service

New file `server/src/services/video.ts`:

```ts
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';

let bundleLocationPromise: Promise<string> | null = null;

function getBundle(): Promise<string> {
  if (!bundleLocationPromise) {
    bundleLocationPromise = bundle({
      entryPoint: path.resolve(__dirname, '../../../remotion/src/index.ts'),
    });
  }
  return bundleLocationPromise;
}

export interface VideoScene {
  text: string;
  durationInSeconds: number;
  imageUrl?: string;
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

  const mediaDir = path.join(process.cwd(), 'data', 'projects', projectId, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const fileName = `${Date.now()}-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.mp4`;
  const outputLocation = path.join(mediaDir, fileName);

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

`getBundle()` is called lazily and cached — first render pays the bundling cost, subsequent renders reuse it.

### 3. Tool definition

`server/src/tools/definitions.ts` — append:

```ts
{
  name: 'generate_video',
  description: 'Render an MP4 video for a project from structured scene data. Runs asynchronously; returns immediately with the execution id, and the project\'s Studio tab will show the finished video once rendering completes.',
  input_schema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: 'ID of the project (should be a video-type project)' },
      title: { type: 'string', description: 'Video title' },
      scenes: {
        type: 'array',
        description: 'Ordered list of scenes to render',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to display during this scene' },
            durationInSeconds: { type: 'number', description: 'How long this scene lasts' },
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

Add `'generate_video'` to the `creative` and `multi`-accessible tool sets in `context.ts`'s `TOOL_SETS.creative` (the `code`/`research`/`writing` sets don't need it).

### 4. Dispatch — async execution pattern

`server/src/services/agent.ts`, in `dispatchTool`'s switch, add:

```ts
case 'generate_video': {
  const title = toolInput.title as string;
  const scenes = toolInput.scenes as VideoScene[];
  // Fire-and-forget: render runs in background, execution updates via existing
  // appendOutput/completeExecution + WebSocket broadcast machinery.
  renderVideo(projectId, title, scenes, (progress) => {
    appendOutput(executionId, userId, `progress:${Math.round(progress * 100)}%\n`);
  })
    .then((fileName) => completeExecution(executionId, userId, 'done', `Rendered ${fileName}`))
    .catch((err) => completeExecution(executionId, userId, 'error', err instanceof Error ? err.message : String(err)));

  result = `Video render started (execution ${executionId}). It will appear in the project's Studio tab when done.`;
  break;
}
```

This returns immediately (the surrounding `try` still calls `completeExecution(executionId, ..., 'done', result)` for the *dispatch* itself — but since `generate_video`'s execution was already given a more specific completion via the `.then`/`.catch` above, the outer `completeExecution` call would double-complete it). To avoid double-completion: extract the generic `try/catch` completion into a flag, OR — simpler — have `generate_video` return early via its own path that skips the outer `completeExecution`. Concretely: refactor the outer completion to check `if (toolName !== 'generate_video')` before calling `completeExecution(executionId, ...)` with the synchronous result, since `generate_video` manages its own execution lifecycle asynchronously.

### 5. Media file storage & serving

New route in `server/src/routes/` (follow existing file-serving route's location/pattern — same file that implements `getProjectFile`'s endpoint): `GET /api/projects/:id/media/:filename` — reads from `data/projects/<id>/media/<filename>`, sets `Content-Type` based on extension (`video/mp4`, `image/png`, etc. via a small extension map), streams the file with `res.sendFile` or a read stream. Validate `filename` has no `..`/path separators before joining (reject with 400 if it does) to prevent path traversal.

New endpoint `GET /api/projects/:id/media` — lists files in `data/projects/<id>/media/` (empty array if dir doesn't exist), returns `{ files: { name: string, url: string, createdAt: number }[] }`.

`web/src/api.ts` (or wherever `getProjectTree`/`getProjectFile` live): add `getProjectMedia(projectId)` calling the list endpoint.

### 6. Media-aware FileBrowser viewer

`web/src/components/FileBrowser.tsx`:
- Add `detectFileKind(path: string): 'image' | 'video' | 'audio' | 'text'`:
  ```ts
  function detectFileKind(filePath: string): 'image' | 'video' | 'audio' | 'text' {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return 'image';
    if (['mp4','webm','mov'].includes(ext)) return 'video';
    if (['mp3','wav','ogg'].includes(ext)) return 'audio';
    return 'text';
  }
  ```
- In the viewer section, before the `isMd`/`else` text branches, add: if `detectFileKind(selectedPath) !== 'text'`, render `<img src={mediaUrl} />` / `<video controls src={mediaUrl} />` / `<audio controls src={mediaUrl} />` instead of fetching via `getProjectFile` (which returns JSON text). `mediaUrl` points at the binary-serving endpoint from #5 (only applicable to files under `media/` — repo files remain text-only for now since `getProjectFile` is repo-tree-based, not media-dir-based; document this distinction in a code comment since it's non-obvious).

### 7. 'Video' project type + Studio tab

Per the project-type-architecture spec's registry:

`web/src/components/StudioTab.tsx` — new component, `{ project: Project }` props:
- Fetches `getProjectMedia(project.id)`.
- Renders a grid of `<video controls>` previews, newest first, with filename/created date.
- Empty state: "No videos yet — ask the agent to generate one."

`web/src/projectTypes.tsx`:
```ts
import { StudioTab } from './components/StudioTab';

export const PROJECT_TYPE_REGISTRY: Record<string, ProjectTypeConfig> = {
  default: { extraTabs: [] },
  video: { extraTabs: [{ id: 'studio', label: 'Studio', component: StudioTab }] },
};
```

`server/src/services/projectTypes.ts`: `PROJECT_TYPES = ['default', 'video']`.

## Acceptance criteria

- [ ] `remotion/` project bundles successfully (`npx remotion render` or via the service) and renders a sample "Scenes" composition to MP4.
- [ ] `generate_video` tool call creates an execution, returns immediately, and the execution transitions to `done` with the file written under `data/projects/<id>/media/`.
- [ ] `GET /api/projects/:id/media` lists rendered files; `GET /api/projects/:id/media/:filename` serves the MP4 with correct `Content-Type` and rejects path-traversal attempts.
- [ ] Creating a project with `type: 'video'` shows a "Studio" tab; after a `generate_video` call completes, the rendered MP4 appears there with a working `<video>` preview.
- [ ] `FileBrowser` renders `<img>`/`<video>`/`<audio>` for media-kind files instead of garbled text.
- [ ] `npm run build` and `npm test` pass in `server/` and `web/`; `remotion/` has its own `npm install` documented in README/setup notes.
