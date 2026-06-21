# Unnamed Project

Local agent workspace for coordinating chats, projects, plans, tool executions, and durable artifacts.

## Project Shape

- `server/`: Express API, SQLite data model, agent/tool orchestration, executions, plans, artifacts, memory, scheduled tasks.
- `web/`: React/Vite client for chats, projects, files, plans, settings, and artifact review.
- `mobile/`: Native iOS app (Swift/UIKit) under `mobile/ios/`.
- `remotion/`: Shared Remotion composition used by the `generate_video` tool.
- `docs/`: current architecture, design-system, and mobile-readiness notes. Historical specs and implementation plans live under `docs/superpowers/archive/`.
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

- `ANTHROPIC_API_KEY` — your Anthropic API key. Required for the agent to run; it can also be configured later in the UI under Settings → connections.

Secrets are handled automatically. On first run the server generates a strong `JWT_SECRET` (auth token signing) and `ENCRYPTION_KEY` (for stored connection secrets) and persists them to `{DATA_DIR}/secrets.json`, so there is nothing to configure for a secure start. **Back up `secrets.json` alongside your database** — deleting it logs everyone out and makes stored connection secrets unrecoverable.

Optional overrides (set these to manage the secrets yourself, e.g. to share them across instances or rotate them — `openssl rand -hex 32` generates a suitable value):

- `JWT_SECRET` — auth token signing secret. Takes precedence over the generated one.
- `ENCRYPTION_KEY` — 64 hex characters used to encrypt stored connection secrets. If unset, it is derived from `JWT_SECRET` when that is provided, otherwise generated. Set it to rotate independently of the signing secret.
- `DATA_DIR` — where the server stores SQLite, secrets, and project files. Defaults to the repo-level `data/` directory. Tests override this with `/tmp/unnamedproject-test`.
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
- Web: usually `http://localhost:5173`; Vite will choose the next open port if 5173 is occupied.

## Docker

Build and run the full stack in containers:

```sh
docker compose up --build
```

The web UI will be available at `http://localhost` (or `http://localhost:$PORT` if you set `PORT` in `.env`). SQLite data is persisted in a named Docker volume (`app-data`).

> **Note:** The `generate_video` tool requires Chromium inside the server container. Video rendering will fail without it. Add `chromium` to the server image and set `PUPPETEER_EXECUTABLE_PATH` if you need that feature.

### Running behind a reverse proxy (TLS)

The containers serve plain HTTP. For any deployment reachable beyond `localhost`, terminate TLS at a reverse proxy (Caddy, nginx, or Traefik) in front of the `web` service and forward to it. The app does not manage certificates itself.

## Database, backups & upgrades

State lives in a single SQLite database at `{DATA_DIR}/app.db` (plus project files, attachments, and media under `{DATA_DIR}`). In Docker this is the `app-data` volume.

Schema changes are applied by a **versioned migration runner** (`server/src/db/migrate.ts`) tracked via SQLite's `PRAGMA user_version`. On startup the server applies any pending migrations in order, each in its own transaction, so an interrupted upgrade never leaves the schema half-applied.

Before applying migrations to a database that already holds data, the server writes a snapshot next to it as `app.db.pre-migrate-<timestamp>` (the five most recent are kept). To roll back a bad upgrade, stop the server and restore that file over `app.db`.

For routine backups, stop the server (or accept a slightly fuzzy copy under WAL) and copy the whole `{DATA_DIR}` directory, or back up the Docker `app-data` volume.

## Operations

- **Health check:** `GET /health` returns `200 {"status":"ok"}` when the server and database are responsive (`503` otherwise). It is unauthenticated and used by the Docker healthcheck — point your own monitor at it too.
- **Logging:** structured logs go to stdout — JSON lines in production, a readable format otherwise. Set `LOG_LEVEL` to `debug`, `info` (default), `warn`, or `error`. Each request is logged with method, path, status, and duration (query strings are never logged, so tokens don't leak).
- **Graceful shutdown:** on `SIGTERM`/`SIGINT` the server stops accepting connections, lets in-flight requests finish, and closes the database before exiting (forced after 10s), so deploys and restarts don't drop work or corrupt the SQLite WAL.

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
