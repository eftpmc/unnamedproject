# Unnamed Project

Local agent workspace for coordinating chats, projects, campaigns, tool executions, and durable artifacts.

## Project Shape

- `server/`: Express API, SQLite data model, agent/tool orchestration, executions, campaigns, artifacts, memory, scheduled tasks.
- `web/`: React/Vite client for chats, projects, files, campaigns, settings, and artifact review.
- `remotion/`: Shared Remotion composition used by the `generate_video` tool.
- `docs/`: product specs, implementation plans, and current architecture notes.
- `data/`: local runtime data. This is ignored by git.

## Setup

Install dependencies from the repo root:

```sh
npm install
npm install --prefix server
npm install --prefix web
npm install --prefix remotion
```

Copy `.env.example` to `.env` and fill in the required values:

```sh
cp .env.example .env
```

Required env vars:

- `JWT_SECRET` — long random string used to sign auth tokens
- `ANTHROPIC_API_KEY` — your Anthropic API key

Optional:

- `DATA_DIR` — where the server stores SQLite and project files. Defaults to the repo-level `data/` directory. Tests override this with `/tmp/unnamedproject-test`.
- `DEFAULT_CLAUDE_MODEL`, `CLAUDE_MODEL_LOW/MEDIUM/HIGH` — override which Claude models are used
- `ALLOW_REGISTRATION` — set to `true` to allow new user sign-ups
- `PORT` — port to expose the web UI on when running via Docker (default: `80`)

## Development

Run the API and web app together:

```sh
npm run dev
```

Default local ports:

- API: `http://localhost:3000`
- Web: `http://localhost:5173`

## Docker

Build and run the full stack in containers:

```sh
docker compose up --build
```

The web UI will be available at `http://localhost` (or `http://localhost:$PORT` if you set `PORT` in `.env`). SQLite data is persisted in a named Docker volume (`app-data`).

> **Note:** The `generate_video` tool requires Chromium inside the server container. Video rendering will fail without it. Add `chromium` to the server image and set `PUPPETEER_EXECUTABLE_PATH` if you need that feature.

## Verification

```sh
npm test
npm run build
```

The server Vitest config intentionally includes only `server/tests/**/*.test.ts` and `server/src/**/*.test.ts`. Generated agent worktrees under `server/data/` are runtime data and must not be collected as part of the app test suite.

## Product Model

Projects are open-ended sandboxes. The app does not use project-type-specific UI such as separate Studio or Research tabs. Generated outputs should be registered as artifacts and reviewed from the project **Artifacts** tab.

Current artifact sources include:

- DB-backed text artifacts created by tools.
- Generated media under `{DATA_DIR}/projects/{projectId}/media/`.
- Legacy research markdown under `{DATA_DIR}/projects/{projectId}/research/`.

The legacy `/projects/:id/media` and `/projects/:id/research` endpoints remain available for compatibility, but the durable product surface is `/projects/:id/artifacts`.

## Smoke Path

After starting the app:

1. Register or log in.
2. Create a project.
3. Start a chat from that project.
4. Ask the agent to produce a durable output.
5. Open the project **Artifacts** tab and verify the output appears and previews correctly.

