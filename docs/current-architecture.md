# Current Architecture

## Project Surface

Projects are capability-detected sandboxes. The UI keeps a stable set of project tabs:

- Overview
- Campaigns
- Chats
- Artifacts
- Files
- Settings

Generated outputs belong in Artifacts. This replaces earlier plans for project-type-specific Studio tabs and capability-specific Research tabs.

## Artifacts

Artifacts are the durable review surface for inspectable work products:

- `create_artifact` writes DB-backed text artifacts.
- `register_artifact` copies generated files into project media storage and registers them.
- `generate_video` writes MP4 files under `{DATA_DIR}/projects/{projectId}/media/` and registers the rendered video as a media artifact.
- Existing markdown files under `{DATA_DIR}/projects/{projectId}/research/` are bridged into the artifact list as legacy research artifacts.

The generic endpoint is:

```txt
GET /projects/:id/artifacts
GET /projects/:id/artifacts/:artifactId/content
```

Media files are still served through:

```txt
GET /projects/:id/media/:filename
```

Research markdown is still served through:

```txt
GET /projects/:id/research/:filename
```

Those media and research routes are compatibility routes. New UI should prefer Artifacts.

## Data Directory

`DATA_DIR` controls runtime storage. If it is unset, the server uses the repo-level `data/` directory. Tests set `DATA_DIR=/tmp/unnamedproject-test`.

