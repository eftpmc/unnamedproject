# Expo Mobile App Design

**Date:** 2026-06-15

A full-parity mobile companion to the Unnamed web app, built with Expo SDK 55. Mirrors the web's sidebar navigation, chat experience, projects, activity, and pipelines. Push notifications for agent approvals are the primary mobile-specific value.

---

## 1. Stack

| Concern | Library |
|---|---|
| Framework | Expo SDK 55 (React Native 0.83, iOS 15.1+) |
| Routing | Expo Router (file-based, drawer layout) |
| Server state | `@tanstack/react-query` |
| Local state | `zustand` |
| Token storage | `expo-secure-store` |
| Push notifications | `expo-notifications` |
| Attachments | `expo-document-picker` + `expo-image-picker` |
| File downloads | `expo-file-system` (authenticated fetch) |
| Styling | NativeWind (Tailwind syntax on RN) |

---

## 2. Project Structure

```
mobile/
  app/
    _layout.tsx                     # Root layout — auth gate, drawer provider
    login.tsx                       # Auth screen
    connect.tsx                     # Server URL / quick-connect
    (drawer)/
      _layout.tsx                   # Drawer nav (mirrors web sidebar)
      index.tsx                     # Empty state (no chat selected)
      c/[chatId].tsx                # Full-screen chat (pushed from drawer or new chat)
      chats.tsx                     # Full searchable chat list
      activity.tsx                  # Activity + approvals
      projects/
        index.tsx                   # Projects list
        [projectId]/
          index.tsx                 # Project overview
          [tab].tsx                 # Campaigns, Artifacts, Files, Settings
      pipelines.tsx                 # Pipelines (read-only v1)
      settings.tsx                  # Settings screen

  components/                       # Shared UI components
  hooks/                            # React Query hooks
  lib/
    api.ts                          # Fetch client
    ws.ts                           # WebSocket manager
    store.ts                        # Zustand store
    notifications.ts                # Push registration + handlers
    storage.ts                      # SecureStore wrappers
```

---

## 3. Navigation

Drawer navigation (offcanvas, swipe-from-left or hamburger icon) mirrors the web sidebar:

- **New Chat** button at top
- Nav items: **Activity** (approval badge), **Chats**, **Projects**, **Pipelines**
- **Recent** — last 5 chats
- Footer: user menu → settings, sign out, theme toggle

Main content area renders the active chat or selected page. No persistent tab bar.

---

## 4. Auth & Connection

### First launch
1. No server URL in store → `connect.tsx`
2. Connect screen offers three paths:
   - **Scan QR** — camera scans QR from web settings, extracts `{ url, token }`, instantly connected
   - **Manual entry** — type server URL → `login.tsx` → `POST /auth/login` → token saved
   - **Saved host chips** — tap a previously used host; reuses the stored token if still valid (skips login), otherwise prompts for login
3. App validates the URL with `GET /auth/me` before proceeding

### Subsequent launches
1. Reads server URL + token from SecureStore on startup
2. Validates with `GET /auth/me` — `401` clears token and shows login
3. Any `401` anywhere clears auth state and navigates to login

### Server switching
- Settings shows saved hosts + "Add server"
- Switching host clears the current token

### QR connect (web → mobile)
- Web settings shows "Connect mobile" button → renders QR encoding `{ url, token }` as JSON
- Mobile scans → extracts both → writes to store + SecureStore → skips login entirely
- Same QR flow works for adding the app on a second device

---

## 5. Data Layer

### API client (`lib/api.ts`)
- Single `apiFetch` wrapper reads server URL and token from Zustand
- Injects `Authorization: Bearer <token>` on every request
- Throws a typed `AuthError` on `401`; Zustand catches it to sign out

### React Query hooks
| Hook | Endpoint |
|---|---|
| `useChats()` | `GET /sessions` |
| `useMessages(chatId)` | `GET /sessions/:id/messages` |
| `useChatStatus(chatId)` | `GET /sessions/:id/status` |
| `useProjects()` | `GET /projects` |
| `useProject(id)` | `GET /projects/:id/capabilities` |
| `useProjectCampaigns(id)` | `GET /projects/:id/campaigns` |
| `useArtifacts(id)` | `GET /projects/:id/artifacts` |
| `usePipelines()` | `GET /pipelines` |
| `useActivity()` | `GET /executions/pending-approvals` |

### Zustand store (`lib/store.ts`)
- `serverUrl`, `token` — persisted to SecureStore on change
- `wsStatus: 'connected' | 'connecting' | 'disconnected'`
- `pendingApprovalCount` — drives drawer badge

### WebSocket (`lib/ws.ts`)
- Single persistent connection after login; token passed as query param
- Reconnects on drop; refreshes `messages` + `status` for active chat on reconnect
- Reconnects when app returns to foreground (`AppState` listener)
- Invalidates React Query cache on relevant events (same strategy as web)
- On reconnect: refresh `GET /sessions/:id/status` and `GET /sessions/:id/messages`

---

## 6. Push Notifications

### Mobile setup
1. After login, request permission via `expo-notifications`
2. Get Expo push token
3. `PATCH /settings` with `{ expoPushToken }` — stored per user on the server

### Server addition (small)
- Add `expo_push_token` column to users table
- When `approval_requested` fires, read user's token and POST to Expo Push API:
  ```json
  {
    "to": "<expo-push-token>",
    "title": "Action needed",
    "body": "<tool name> is waiting for approval",
    "data": { "sessionId": "...", "executionId": "..." }
  }
  ```
- Plain `fetch` to `https://exp.host/--/api/v2/push/send` — no SDK needed

### Notification handling
- **Foreground:** in-app banner + badge increment on Activity nav item
- **Background/killed:** system notification → tap → deep-links to `activity.tsx` with execution highlighted
- App badge count mirrors `pendingApprovalCount`; cleared when Activity screen opens and all approvals are resolved

---

## 7. Attachments

Composer supports text + attachments, matching the web's multipart upload:

- **Images:** `expo-image-picker` (camera roll or camera)
- **Files:** `expo-document-picker` (any file type)
- Max 8 attachments, 10 MB each (enforced client-side before upload)
- Uploaded via `POST /sessions/:id/messages` multipart form data with `content` + `attachments[]`
- Downloads require authenticated fetch (not plain URLs) — use `expo-file-system` with auth header

---

## 8. Screen Inventory

| Screen | Route | Notes |
|---|---|---|
| Connect | `connect.tsx` | QR scan, manual URL, saved hosts |
| Login | `login.tsx` | Email + password |
| Home | `(drawer)/index.tsx` | Empty state (no chat selected) |
| Chat | `(drawer)/c/[chatId].tsx` | Messages, streaming, executions, composer |
| Chats | `(drawer)/chats.tsx` | Full searchable list |
| Activity | `(drawer)/activity.tsx` | Approvals (top, prominent) + events |
| Projects | `(drawer)/projects/index.tsx` | Grid/list |
| Project detail | `(drawer)/projects/[projectId]/index.tsx` | Overview |
| Project tab | `(drawer)/projects/[projectId]/[tab].tsx` | Campaigns, Artifacts, Files, Settings |
| Pipelines | `(drawer)/pipelines.tsx` | Read-only v1 |
| Settings | `(drawer)/settings.tsx` | Hosts, QR generator, theme, sign out |

---

## 9. Backend Additions Required

Two small server-side changes:

1. **Push token storage** — add `expo_push_token TEXT` column to users table; accept it via `PATCH /settings`
2. **Push notification dispatch** — when `approval_requested` fires in the execution layer, fetch the user's push token and call the Expo Push API

No other server changes. All other endpoints are already documented in `docs/mobile-readiness.md`.
