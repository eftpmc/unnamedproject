# Expo Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-parity Expo SDK 55 mobile companion to the Unnamed web app with drawer navigation, JWT auth (including QR quick-connect), real-time chat via WebSocket, approvals, projects, pipelines, and push notifications.

**Architecture:** Standalone `mobile/` Expo app mirroring the web's offcanvas drawer pattern. Zustand holds auth/server/WS state (persisted to SecureStore). React Query handles server state with the same hook shapes as the web. A single `apiFetch` wrapper injects the bearer token and signs out on 401. Two small server additions: push token storage and push dispatch on approval.

**Tech Stack:** Expo SDK 55, Expo Router (drawer), NativeWind v4, React Query 5, Zustand 5, expo-secure-store, expo-notifications, expo-document-picker, expo-image-picker, expo-file-system, expo-camera (QR scanner).

---

## File Map

**New — `mobile/`**
- `app.json` — Expo config (scheme, plugins, permissions)
- `babel.config.js` — NativeWind preset + Reanimated plugin
- `metro.config.js` — NativeWind metro
- `tailwind.config.js` — content paths + nativewind preset
- `global.css` — Tailwind base import
- `nativewind-env.d.ts` — NativeWind type shim
- `types.ts` — shared TypeScript types (Chat, Message, Project, etc.)
- `app/_layout.tsx` — root layout: hydrates store, auth gate
- `app/login.tsx` — email + password login
- `app/connect.tsx` — server URL entry, QR scanner, saved host chips
- `app/(drawer)/_layout.tsx` — drawer navigator with custom DrawerContent
- `app/(drawer)/index.tsx` — empty state
- `app/(drawer)/c/[chatId].tsx` — chat screen
- `app/(drawer)/chats.tsx` — full chat list
- `app/(drawer)/activity.tsx` — pending approvals + events
- `app/(drawer)/projects/index.tsx` — projects list
- `app/(drawer)/projects/[projectId]/index.tsx` — project overview
- `app/(drawer)/projects/[projectId]/[tab].tsx` — project tabs
- `app/(drawer)/pipelines.tsx` — pipelines list
- `app/(drawer)/settings.tsx` — server management + sign out
- `lib/storage.ts` — SecureStore wrappers + saved-hosts list
- `lib/store.ts` — Zustand store (auth, serverUrl, wsStatus, pendingApprovalCount)
- `lib/api.ts` — `apiFetch` with auth injection + 401 handling
- `lib/ws.ts` — WebSocket manager (connect/disconnect/subscribe)
- `lib/notifications.ts` — push token registration + notification handlers
- `hooks/useChats.ts`, `useMessages.ts`, `useChatStatus.ts`, `useProjects.ts`, `useActivity.ts`, `usePipelines.ts`
- `components/DrawerContent.tsx` — custom drawer nav (mirrors web Sidebar)
- `components/ChatBubble.tsx` — user/assistant message bubble
- `components/ExecutionCard.tsx` — tool execution display
- `components/ApprovalCard.tsx` — pending approval with approve/reject
- `components/Composer.tsx` — text input + attachment buttons
- `__tests__/lib/storage.test.ts`
- `__tests__/lib/store.test.ts`
- `__tests__/lib/api.test.ts`

**Modified — server**
- `server/src/db/index.ts` — add `expo_push_token` column to `user_settings`, add `getExpoPushToken`/`setExpoPushToken` helpers
- `server/src/routes/settings.ts` — accept `expoPushToken` in `PUT /settings`
- `server/src/services/executor.ts` — send push notification after `approval_requested` broadcast

**Modified — web**
- `web/src/pages/Settings.tsx` — add "Connect Mobile" section with QR code

---

## Task 1: Scaffold Expo SDK 55

**Files:**
- Create: `mobile/` (entire directory via create-expo-app)
- Create: `mobile/types.ts`

- [ ] **Step 1: Run create-expo-app from the repo root**

```bash
cd /path/to/unnamedproject
npx create-expo-app@latest mobile --template default@sdk-55
```

Expected: `mobile/` directory created with `app.json`, `package.json`, `app/index.tsx`, etc.

- [ ] **Step 2: Install Expo Router and drawer dependencies**

```bash
cd mobile
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar
npx expo install @react-navigation/drawer react-native-reanimated react-native-worklets react-native-gesture-handler
npx expo install expo-secure-store expo-camera expo-document-picker expo-image-picker expo-file-system expo-notifications
```

- [ ] **Step 3: Install JS dependencies**

```bash
npm install zustand @tanstack/react-query nativewind tailwindcss
npm install --save-dev @testing-library/react-native @types/react
```

- [ ] **Step 4: Create `mobile/types.ts`**

```typescript
export interface Chat {
  id: string
  title: string | null
  effort: 'low' | 'medium' | 'high'
  model: string | null
  created_at: number
  updated_at: number
}

export interface Attachment {
  id: string
  filename: string
  content_type: string
  size: number
  url: string
}

export interface Execution {
  id: string
  tool: string
  status: 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval' | 'cancelled'
  input?: unknown
  output?: string
  error?: string
}

export interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: number
  attachments?: Attachment[]
  executions?: Execution[]
}

export interface ChatStatus {
  active: boolean
  turn?: { id: string; status: string }
  execution?: { id: string; status: string }
}

export interface PendingApproval {
  id: string
  execution_id: string
  session_id: string | null
  action: string
  payload: unknown
  created_at: number
}

export interface Project {
  id: string
  name: string
  description: string | null
  created_at: number
  updated_at: number
}

export interface Campaign {
  id: string
  project_id: string
  name: string
  status: string
  created_at: number
}

export interface Artifact {
  id: string
  name: string
  type: string
  created_at: number
}

export interface Pipeline {
  id: string
  name: string
  description: string | null
  created_at: number
}

export interface WSEvent {
  type: string
  sessionId?: string
  executionId?: string
  approvalId?: string
  action?: string
  payload?: unknown
  delta?: string
  message?: Message
  [key: string]: unknown
}
```

- [ ] **Step 5: Commit**

```bash
git add mobile/
git commit -m "feat(mobile): scaffold Expo SDK 55 project"
```

---

## Task 2: NativeWind + Build Config

**Files:**
- Create: `mobile/tailwind.config.js`
- Create: `mobile/global.css`
- Create: `mobile/nativewind-env.d.ts`
- Modify: `mobile/babel.config.js`
- Modify: `mobile/metro.config.js`
- Modify: `mobile/app.json`

- [ ] **Step 1: Create `mobile/tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        muted: 'var(--color-muted)',
        primary: 'var(--color-primary)',
        border: 'var(--color-border)',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Create `mobile/global.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: Create `mobile/nativewind-env.d.ts`**

```typescript
/// <reference types="nativewind/types" />
```

- [ ] **Step 4: Replace `mobile/babel.config.js`**

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

- [ ] **Step 5: Replace `mobile/metro.config.js`**

```javascript
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: './global.css' });
```

- [ ] **Step 6: Update `mobile/app.json` — add scheme and router entry point**

In `mobile/app.json`, ensure `expo.scheme` and `expo.plugins` are set (merge with existing):

```json
{
  "expo": {
    "name": "Unnamed",
    "slug": "unnamed",
    "scheme": "unnamed",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "plugins": [
      "expo-router",
      "expo-secure-store",
      [
        "expo-notifications",
        {
          "icon": "./assets/images/icon.png",
          "color": "#ffffff"
        }
      ],
      [
        "expo-camera",
        { "cameraPermission": "Allow Unnamed to scan QR codes to connect to your server." }
      ],
      [
        "expo-document-picker",
        { "iCloudContainerEnvironment": "Production" }
      ]
    ],
    "ios": {
      "bundleIdentifier": "com.unnamed.app",
      "supportsTablet": false
    },
    "android": {
      "package": "com.unnamed.app"
    }
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add mobile/
git commit -m "feat(mobile): configure NativeWind and build tooling"
```

---

## Task 3: SecureStore + Zustand Store

**Files:**
- Create: `mobile/lib/storage.ts`
- Create: `mobile/lib/store.ts`
- Create: `mobile/__tests__/lib/storage.test.ts`
- Create: `mobile/__tests__/lib/store.test.ts`

- [ ] **Step 1: Write failing tests for storage**

Create `mobile/__tests__/lib/storage.test.ts`:

```typescript
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store');

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

import {
  getServerUrl, setServerUrl,
  getToken, setToken, clearToken,
  getSavedHosts, addSavedHost,
} from '../../lib/storage';

beforeEach(() => jest.clearAllMocks());

describe('token', () => {
  it('returns null when no token stored', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    expect(await getToken()).toBeNull();
  });

  it('stores and retrieves token', async () => {
    mockSecureStore.setItemAsync.mockResolvedValue();
    mockSecureStore.getItemAsync.mockResolvedValue('tok123');
    await setToken('tok123');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'tok123');
    expect(await getToken()).toBe('tok123');
  });

  it('deletes token on clearToken', async () => {
    mockSecureStore.deleteItemAsync.mockResolvedValue();
    await clearToken();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
  });
});

describe('serverUrl', () => {
  it('returns null when nothing stored', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    expect(await getServerUrl()).toBeNull();
  });

  it('stores and retrieves url', async () => {
    mockSecureStore.setItemAsync.mockResolvedValue();
    mockSecureStore.getItemAsync.mockResolvedValue('http://192.168.1.5:3000');
    await setServerUrl('http://192.168.1.5:3000');
    expect(await getServerUrl()).toBe('http://192.168.1.5:3000');
  });
});

describe('savedHosts', () => {
  it('returns empty array when none saved', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    expect(await getSavedHosts()).toEqual([]);
  });

  it('adds host and deduplicates', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(['http://a:3000']));
    mockSecureStore.setItemAsync.mockResolvedValue();
    await addSavedHost('http://b:3000');
    const saved = JSON.parse(mockSecureStore.setItemAsync.mock.calls[0][1] as string) as string[];
    expect(saved[0]).toBe('http://b:3000');
    expect(saved).toContain('http://a:3000');
  });

  it('caps saved hosts at 3', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(['http://a:3000', 'http://b:3000', 'http://c:3000']));
    mockSecureStore.setItemAsync.mockResolvedValue();
    await addSavedHost('http://d:3000');
    const saved = JSON.parse(mockSecureStore.setItemAsync.mock.calls[0][1] as string) as string[];
    expect(saved).toHaveLength(3);
    expect(saved[0]).toBe('http://d:3000');
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
cd mobile && npx jest __tests__/lib/storage.test.ts
```

Expected: FAIL — `../../lib/storage` cannot be found.

- [ ] **Step 3: Implement `mobile/lib/storage.ts`**

```typescript
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  TOKEN: 'auth_token',
  SERVER_URL: 'server_url',
  SAVED_HOSTS: 'saved_hosts',
} as const;

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.TOKEN);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.TOKEN, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.TOKEN);
}

export async function getServerUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.SERVER_URL);
}

export async function setServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.SERVER_URL, url);
}

export async function getSavedHosts(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(KEYS.SAVED_HOSTS);
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export async function addSavedHost(url: string): Promise<void> {
  const existing = await getSavedHosts();
  const deduped = [url, ...existing.filter(h => h !== url)].slice(0, 3);
  await SecureStore.setItemAsync(KEYS.SAVED_HOSTS, JSON.stringify(deduped));
}
```

- [ ] **Step 4: Run storage tests — expect PASS**

```bash
npx jest __tests__/lib/storage.test.ts
```

- [ ] **Step 5: Write failing store tests**

Create `mobile/__tests__/lib/store.test.ts`:

```typescript
jest.mock('expo-secure-store');
jest.mock('../../lib/storage', () => ({
  setToken: jest.fn(),
  clearToken: jest.fn(),
  setServerUrl: jest.fn(),
  getSavedHosts: jest.fn().mockResolvedValue([]),
  addSavedHost: jest.fn(),
}));

import { useAppStore } from '../../lib/store';

beforeEach(() => useAppStore.setState({
  serverUrl: null, token: null,
  wsStatus: 'disconnected', pendingApprovalCount: 0,
}));

it('setToken updates state', async () => {
  await useAppStore.getState().setToken('abc');
  expect(useAppStore.getState().token).toBe('abc');
});

it('signOut clears token and resets counts', async () => {
  useAppStore.setState({ token: 'tok', pendingApprovalCount: 3 });
  await useAppStore.getState().signOut();
  expect(useAppStore.getState().token).toBeNull();
  expect(useAppStore.getState().pendingApprovalCount).toBe(0);
});

it('incrementPendingApprovals increments', () => {
  useAppStore.setState({ pendingApprovalCount: 1 });
  useAppStore.getState().incrementPendingApprovals();
  expect(useAppStore.getState().pendingApprovalCount).toBe(2);
});

it('decrementPendingApprovals does not go below 0', () => {
  useAppStore.setState({ pendingApprovalCount: 0 });
  useAppStore.getState().decrementPendingApprovals();
  expect(useAppStore.getState().pendingApprovalCount).toBe(0);
});
```

- [ ] **Step 6: Implement `mobile/lib/store.ts`**

```typescript
import { create } from 'zustand';
import { setToken as persistToken, clearToken, setServerUrl as persistUrl, addSavedHost } from './storage';

type WsStatus = 'connected' | 'connecting' | 'disconnected';

interface AppState {
  serverUrl: string | null;
  token: string | null;
  wsStatus: WsStatus;
  pendingApprovalCount: number;
  setServerUrl: (url: string) => Promise<void>;
  setToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  hydrate: (serverUrl: string | null, token: string | null) => void;
  setWsStatus: (status: WsStatus) => void;
  setPendingApprovalCount: (n: number) => void;
  incrementPendingApprovals: () => void;
  decrementPendingApprovals: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  serverUrl: null,
  token: null,
  wsStatus: 'disconnected',
  pendingApprovalCount: 0,

  setServerUrl: async (url) => {
    await persistUrl(url);
    await addSavedHost(url);
    set({ serverUrl: url });
  },

  setToken: async (token) => {
    await persistToken(token);
    set({ token });
  },

  signOut: async () => {
    await clearToken();
    set({ token: null, pendingApprovalCount: 0, wsStatus: 'disconnected' });
  },

  hydrate: (serverUrl, token) => set({ serverUrl, token }),

  setWsStatus: (wsStatus) => set({ wsStatus }),

  setPendingApprovalCount: (pendingApprovalCount) => set({ pendingApprovalCount }),

  incrementPendingApprovals: () =>
    set(s => ({ pendingApprovalCount: s.pendingApprovalCount + 1 })),

  decrementPendingApprovals: () =>
    set(s => ({ pendingApprovalCount: Math.max(0, s.pendingApprovalCount - 1) })),
}));
```

- [ ] **Step 7: Run store tests — expect PASS**

```bash
npx jest __tests__/lib/store.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add mobile/lib/storage.ts mobile/lib/store.ts mobile/__tests__/
git commit -m "feat(mobile): add SecureStore wrappers and Zustand store"
```

---

## Task 4: API Client

**Files:**
- Create: `mobile/lib/api.ts`
- Create: `mobile/__tests__/lib/api.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `mobile/__tests__/lib/api.test.ts`:

```typescript
jest.mock('../lib/store', () => ({
  useAppStore: {
    getState: jest.fn(),
  },
}));

import { useAppStore } from '../../lib/store';
import { apiFetch, uploadMessage } from '../../lib/api';

const mockGetState = useAppStore.getState as jest.Mock;
const signOut = jest.fn();

function stubStore(overrides: { serverUrl?: string; token?: string } = {}) {
  mockGetState.mockReturnValue({
    serverUrl: overrides.serverUrl ?? 'http://localhost:3000',
    token: overrides.token ?? 'tok123',
    signOut,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

it('injects Authorization header', async () => {
  stubStore();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: 1 }),
  });
  await apiFetch('/test');
  expect(global.fetch).toHaveBeenCalledWith(
    'http://localhost:3000/test',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
    })
  );
});

it('calls signOut and throws on 401', async () => {
  stubStore();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false, status: 401,
    text: async () => 'Unauthorized',
  });
  await expect(apiFetch('/secure')).rejects.toThrow('Unauthorized');
  expect(signOut).toHaveBeenCalled();
});

it('throws on non-401 error', async () => {
  stubStore();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false, status: 500,
    text: async () => 'Internal Server Error',
  });
  await expect(apiFetch('/fail')).rejects.toThrow('500');
  expect(signOut).not.toHaveBeenCalled();
});

it('throws when no serverUrl', async () => {
  stubStore({ serverUrl: undefined });
  await expect(apiFetch('/any')).rejects.toThrow('No server URL');
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx jest __tests__/lib/api.test.ts
```

Expected: FAIL — `../../lib/api` not found.

- [ ] **Step 3: Implement `mobile/lib/api.ts`**

```typescript
import { useAppStore } from './store';

class AuthError extends Error {
  constructor() { super('Unauthorized'); }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { serverUrl, token, signOut } = useAppStore.getState();
  if (!serverUrl) throw new Error('No server URL configured');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${serverUrl}${path}`, { ...init, headers });

  if (res.status === 401) {
    signOut();
    throw new AuthError();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

/** Multipart upload for messages with attachments */
export async function uploadMessage(
  sessionId: string,
  content: string,
  attachments: Array<{ uri: string; name: string; type: string }>
): Promise<unknown> {
  const { serverUrl, token, signOut } = useAppStore.getState();
  if (!serverUrl) throw new Error('No server URL configured');

  const form = new FormData();
  form.append('content', content);
  for (const att of attachments) {
    form.append('attachments', { uri: att.uri, name: att.name, type: att.type } as unknown as Blob);
  }

  const res = await fetch(`${serverUrl}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (res.status === 401) { signOut(); throw new Error('Unauthorized'); }
  if (!res.ok) { const t = await res.text(); throw new Error(`${res.status}: ${t}`); }
  return res.json();
}
```

- [ ] **Step 4: Run API tests — expect PASS**

```bash
npx jest __tests__/lib/api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/api.ts mobile/__tests__/lib/api.test.ts
git commit -m "feat(mobile): add API client with auth injection and 401 handling"
```

---

## Task 5: WebSocket Manager

**Files:**
- Create: `mobile/lib/ws.ts`

- [ ] **Step 1: Create `mobile/lib/ws.ts`**

```typescript
import { AppState } from 'react-native';
import { useAppStore } from './store';
import type { WSEvent } from '../types';

type Listener = (event: WSEvent) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

export function connect(): void {
  const { serverUrl, token } = useAppStore.getState();
  if (!serverUrl || !token) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  useAppStore.getState().setWsStatus('connecting');

  const wsUrl = `${serverUrl.replace(/^http/, 'ws')}?token=${token}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    useAppStore.getState().setWsStatus('connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onclose = () => {
    useAppStore.getState().setWsStatus('disconnected');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => ws?.close();

  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WSEvent;
      listeners.forEach(l => l(event));
    } catch { /* ignore malformed events */ }
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

export function disconnect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  ws?.close();
  ws = null;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call once after login to handle foreground reconnects */
export function startAppStateListener(): void {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') connect();
  });
}

export function stopAppStateListener(): void {
  appStateSub?.remove();
  appStateSub = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/lib/ws.ts
git commit -m "feat(mobile): add WebSocket manager with reconnect and AppState listener"
```

---

## Task 6: React Query Hooks

**Files:**
- Create: `mobile/hooks/useChats.ts`
- Create: `mobile/hooks/useMessages.ts`
- Create: `mobile/hooks/useChatStatus.ts`
- Create: `mobile/hooks/useProjects.ts`
- Create: `mobile/hooks/useActivity.ts`
- Create: `mobile/hooks/usePipelines.ts`

- [ ] **Step 1: Create `mobile/hooks/useChats.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Chat } from '../types';

export function useChats() {
  return useQuery<Chat[]>({
    queryKey: ['chats'],
    queryFn: () => apiFetch('/sessions'),
  });
}

export function useCreateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ id: string }>('/sessions', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chats'] }),
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chats'] }),
  });
}
```

- [ ] **Step 2: Create `mobile/hooks/useMessages.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, uploadMessage } from '../lib/api';
import type { Message } from '../types';

export function useMessages(chatId: string) {
  return useQuery<Message[]>({
    queryKey: ['messages', chatId],
    queryFn: () => apiFetch(`/sessions/${chatId}/messages`),
    enabled: !!chatId,
  });
}

export function useSendMessage(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      content,
      attachments = [],
    }: {
      content: string;
      attachments?: Array<{ uri: string; name: string; type: string }>;
    }) =>
      attachments.length > 0
        ? uploadMessage(chatId, content, attachments)
        : apiFetch(`/sessions/${chatId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content }),
          }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', chatId] }),
  });
}
```

- [ ] **Step 3: Create `mobile/hooks/useChatStatus.ts`**

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { ChatStatus } from '../types';

export function useChatStatus(chatId: string) {
  return useQuery<ChatStatus>({
    queryKey: ['chat-status', chatId],
    queryFn: () => apiFetch(`/sessions/${chatId}/status`),
    enabled: !!chatId,
    refetchInterval: (query) => (query.state.data?.active ? 3000 : false),
  });
}
```

- [ ] **Step 4: Create `mobile/hooks/useProjects.ts`**

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, Campaign, Artifact } from '../types';

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => apiFetch('/projects'),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => apiFetch<{ capabilities: string[] }>(`/projects/${id}/capabilities`),
    enabled: !!id,
  });
}

export function useProjectCampaigns(id: string) {
  return useQuery<Campaign[]>({
    queryKey: ['project-campaigns', id],
    queryFn: () => apiFetch(`/projects/${id}/campaigns`),
    enabled: !!id,
  });
}

export function useArtifacts(id: string) {
  return useQuery<Artifact[]>({
    queryKey: ['artifacts', id],
    queryFn: () => apiFetch(`/projects/${id}/artifacts`),
    enabled: !!id,
  });
}
```

- [ ] **Step 5: Create `mobile/hooks/useActivity.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { PendingApproval } from '../types';

export function useActivity() {
  return useQuery<PendingApproval[]>({
    queryKey: ['activity'],
    queryFn: () => apiFetch('/executions/pending-approvals'),
  });
}

export function useApproveExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/executions/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity'] }),
  });
}

export function useRejectExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/executions/${id}/reject`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity'] }),
  });
}
```

- [ ] **Step 6: Create `mobile/hooks/usePipelines.ts`**

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Pipeline } from '../types';

export function usePipelines() {
  return useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: () => apiFetch('/pipelines'),
  });
}
```

- [ ] **Step 7: Commit**

```bash
git add mobile/hooks/
git commit -m "feat(mobile): add React Query hooks for all API endpoints"
```

---

## Task 7: Root Layout + Auth Gate

**Files:**
- Create: `mobile/app/_layout.tsx`

- [ ] **Step 1: Replace `mobile/app/_layout.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAppStore } from '../lib/store';
import { getServerUrl, getToken } from '../lib/storage';
import { connect, disconnect, startAppStateListener, stopAppStateListener } from '../lib/ws';
import '../global.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AuthGate() {
  const { token, serverUrl } = useAppStore();
  const router = useRouter();
  const segments = useSegments();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    async function hydrate() {
      const [url, tok] = await Promise.all([getServerUrl(), getToken()]);
      useAppStore.getState().hydrate(url, tok);
      setHydrated(true);
    }
    hydrate();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const inDrawer = segments[0] === '(drawer)';

    if (!serverUrl) {
      router.replace('/connect');
    } else if (!token && inDrawer) {
      router.replace('/login');
    } else if (token && !inDrawer && segments[0] !== 'login' && segments[0] !== 'connect') {
      router.replace('/(drawer)');
    }
  }, [hydrated, token, serverUrl, segments]);

  useEffect(() => {
    if (token && serverUrl) {
      connect();
      startAppStateListener();
    } else {
      disconnect();
      stopAppStateListener();
    }
    return () => { disconnect(); stopAppStateListener(); };
  }, [token, serverUrl]);

  if (!hydrated) return null;
  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthGate />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/_layout.tsx
git commit -m "feat(mobile): root layout with auth gate and WS lifecycle"
```

---

## Task 8: Connect Screen + Login Screen

**Files:**
- Create: `mobile/app/connect.tsx`
- Create: `mobile/app/login.tsx`

- [ ] **Step 1: Create `mobile/app/connect.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAppStore } from '../lib/store';
import { getSavedHosts } from '../lib/storage';

export default function ConnectScreen() {
  const [url, setUrl] = useState('http://');
  const [savedHosts, setSavedHosts] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const { setServerUrl, setToken } = useAppStore();
  const router = useRouter();

  useEffect(() => {
    getSavedHosts().then(setSavedHosts);
  }, []);

  async function connect(targetUrl: string) {
    setLoading(true);
    try {
      const normalized = targetUrl.replace(/\/$/, '');
      const res = await fetch(`${normalized}/auth/me`, {
        headers: useAppStore.getState().token
          ? { Authorization: `Bearer ${useAppStore.getState().token}` }
          : {},
      });
      if (res.status === 401) {
        await setServerUrl(normalized);
        router.replace('/login');
      } else if (res.ok) {
        await setServerUrl(normalized);
        router.replace('/(drawer)');
      } else {
        Alert.alert('Connection failed', `Server returned ${res.status}`);
      }
    } catch {
      Alert.alert('Connection failed', 'Could not reach that address. Check the URL and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleQrScan({ data }: { data: string }) {
    setScanning(false);
    try {
      const parsed = JSON.parse(data) as { url: string; token: string };
      if (!parsed.url || !parsed.token) throw new Error('Invalid QR');
      await setServerUrl(parsed.url);
      await setToken(parsed.token);
      router.replace('/(drawer)');
    } catch {
      Alert.alert('Invalid QR code', 'Could not read server info from the QR code.');
    }
  }

  async function handleScanPress() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) { Alert.alert('Camera permission required'); return; }
    }
    setScanning(true);
  }

  if (scanning) {
    return (
      <View className="flex-1 bg-black">
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleQrScan}
        />
        <TouchableOpacity
          className="absolute bottom-12 self-center bg-white/20 px-6 py-3 rounded-full"
          onPress={() => setScanning(false)}
        >
          <Text className="text-white font-medium">Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background px-6 justify-center gap-8">
      <View className="gap-1">
        <Text className="text-2xl font-bold text-foreground">Connect to server</Text>
        <Text className="text-muted-foreground text-sm">Enter your server address or scan a QR code</Text>
      </View>

      <View className="gap-3">
        <TextInput
          className="bg-muted rounded-xl px-4 py-3 text-foreground text-base"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.x:3000"
          placeholderTextColor="#666"
          onSubmitEditing={() => connect(url)}
        />
        <TouchableOpacity
          className="bg-primary rounded-xl py-3 items-center"
          onPress={() => connect(url)}
          disabled={loading}
        >
          <Text className="text-primary-foreground font-semibold">
            {loading ? 'Connecting…' : 'Connect'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="border border-border rounded-xl py-3 items-center"
          onPress={handleScanPress}
        >
          <Text className="text-foreground font-medium">Scan QR code</Text>
        </TouchableOpacity>
      </View>

      {savedHosts.length > 0 && (
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent</Text>
          <FlatList
            data={savedHosts}
            keyExtractor={item => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                className="bg-muted rounded-xl px-4 py-3 mb-2"
                onPress={() => connect(item)}
              >
                <Text className="text-foreground text-sm">{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Create `mobile/app/login.tsx`**

```typescript
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '../lib/store';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { serverUrl, setToken } = useAppStore();
  const router = useRouter();

  async function handleLogin() {
    if (!email || !password) { Alert.alert('Enter email and password'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const { error } = await res.json() as { error?: string };
        Alert.alert('Login failed', error ?? 'Invalid credentials');
        return;
      }
      const { token } = await res.json() as { token: string };
      await setToken(token);
      router.replace('/(drawer)');
    } catch {
      Alert.alert('Login failed', 'Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 px-6 justify-center gap-8">
        <View className="gap-1">
          <Text className="text-2xl font-bold text-foreground">Sign in</Text>
          <Text className="text-muted-foreground text-sm">{serverUrl}</Text>
        </View>
        <View className="gap-3">
          <TextInput
            className="bg-muted rounded-xl px-4 py-3 text-foreground text-base"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#666"
          />
          <TextInput
            className="bg-muted rounded-xl px-4 py-3 text-foreground text-base"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor="#666"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity
            className="bg-primary rounded-xl py-3 items-center"
            onPress={handleLogin}
            disabled={loading}
          >
            <Text className="text-primary-foreground font-semibold">
              {loading ? 'Signing in…' : 'Sign in'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="py-3 items-center"
            onPress={() => router.replace('/connect')}
          >
            <Text className="text-muted-foreground text-sm">Change server</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add mobile/app/connect.tsx mobile/app/login.tsx
git commit -m "feat(mobile): connect screen with QR scanner and login screen"
```

---

## Task 9: Drawer Navigation

**Files:**
- Create: `mobile/components/DrawerContent.tsx`
- Create: `mobile/app/(drawer)/_layout.tsx`
- Create: `mobile/app/(drawer)/index.tsx`

- [ ] **Step 1: Create `mobile/components/DrawerContent.tsx`**

```typescript
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { useQueryClient } from '@tanstack/react-query';
import { useChats, useCreateChat } from '../hooks/useChats';
import { useAppStore } from '../lib/store';
import type { Chat } from '../types';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const NAV_ITEMS = [
  { label: 'Activity', href: '/(drawer)/activity', showBadge: true },
  { label: 'Chats', href: '/(drawer)/chats' },
  { label: 'Projects', href: '/(drawer)/projects' },
  { label: 'Pipelines', href: '/(drawer)/pipelines' },
];

export default function DrawerContent(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: chats = [] } = useChats();
  const createChat = useCreateChat();
  const { pendingApprovalCount, signOut } = useAppStore();

  async function handleNewChat() {
    const { id } = await createChat.mutateAsync();
    router.push(`/(drawer)/c/${id}`);
    props.navigation?.closeDrawer?.();
  }

  function go(href: string) {
    router.push(href as Parameters<typeof router.push>[0]);
    props.navigation?.closeDrawer?.();
  }

  const recentChats = chats.slice(0, 5);

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ flex: 1 }}>
      <View className="flex-1 px-3 py-4 gap-4">
        {/* Header */}
        <View className="flex-row items-center gap-2 px-2">
          <View className="w-7 h-7 rounded-lg bg-primary items-center justify-center">
            <Text className="text-primary-foreground text-xs font-bold">u</Text>
          </View>
          <Text className="text-foreground font-semibold">unnamed</Text>
        </View>

        {/* New Chat */}
        <TouchableOpacity
          className="bg-primary rounded-xl py-2.5 items-center"
          onPress={handleNewChat}
          disabled={createChat.isPending}
        >
          <Text className="text-primary-foreground font-medium">+ New chat</Text>
        </TouchableOpacity>

        {/* Nav */}
        <View className="gap-1">
          {NAV_ITEMS.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <TouchableOpacity
                key={item.href}
                className={`flex-row items-center justify-between rounded-lg px-3 py-2.5 ${active ? 'bg-muted' : ''}`}
                onPress={() => go(item.href)}
              >
                <Text className={`text-sm font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {item.label}
                </Text>
                {item.showBadge && pendingApprovalCount > 0 && (
                  <View className="bg-yellow-500 rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
                    <Text className="text-white text-[10px] font-bold">{pendingApprovalCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Recent chats */}
        {recentChats.length > 0 && (
          <View className="gap-1">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2">Recent</Text>
            {recentChats.map((chat: Chat) => {
              const active = pathname === `/(drawer)/c/${chat.id}`;
              return (
                <TouchableOpacity
                  key={chat.id}
                  className={`rounded-lg px-2.5 py-2 ${active ? 'bg-muted' : ''}`}
                  onPress={() => go(`/(drawer)/c/${chat.id}`)}
                >
                  <Text className="text-xs font-medium text-foreground truncate" numberOfLines={1}>
                    {chat.title ?? 'Untitled chat'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Footer */}
        <View className="mt-auto border-t border-border pt-3 gap-1">
          <TouchableOpacity
            className="flex-row items-center gap-2 px-2 py-2.5"
            onPress={() => go('/(drawer)/settings')}
          >
            <Text className="text-sm text-muted-foreground">Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-row items-center gap-2 px-2 py-2.5"
            onPress={() => signOut()}
          >
            <Text className="text-sm text-muted-foreground">Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </DrawerContentScrollView>
  );
}
```

- [ ] **Step 2: Create `mobile/app/(drawer)/_layout.tsx`**

```typescript
import { Drawer } from 'expo-router/drawer';
import DrawerContent from '../../components/DrawerContent';

export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        swipeEdgeWidth: 60,
      }}
    />
  );
}
```

- [ ] **Step 3: Create `mobile/app/(drawer)/index.tsx`**

```typescript
import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useCreateChat } from '../../hooks/useChats';
import { useRouter } from 'expo-router';

export default function HomeScreen() {
  const navigation = useNavigation();
  const createChat = useCreateChat();
  const router = useRouter();

  async function handleNewChat() {
    const { id } = await createChat.mutateAsync();
    router.push(`/(drawer)/c/${id}`);
  }

  return (
    <View className="flex-1 bg-background">
      {/* Mobile top bar */}
      <View className="border-b border-border px-4 py-2.5 flex-row items-center justify-between">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground text-lg">☰</Text>
        </TouchableOpacity>
        <View className="w-7 h-7 rounded-lg bg-primary items-center justify-center">
          <Text className="text-primary-foreground text-xs font-semibold">u</Text>
        </View>
        <View className="w-9" />
      </View>

      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text className="text-2xl font-bold text-foreground">unnamed</Text>
        <Text className="text-muted-foreground text-center text-sm">
          Start a new conversation or open an existing one from the menu.
        </Text>
        <TouchableOpacity
          className="bg-primary rounded-xl px-6 py-3 mt-2"
          onPress={handleNewChat}
          disabled={createChat.isPending}
        >
          <Text className="text-primary-foreground font-medium">New chat</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add mobile/components/DrawerContent.tsx mobile/app/(drawer)/
git commit -m "feat(mobile): drawer navigation with custom drawer content"
```

---

## Task 10: Shared Components

**Files:**
- Create: `mobile/components/ChatBubble.tsx`
- Create: `mobile/components/ExecutionCard.tsx`
- Create: `mobile/components/ApprovalCard.tsx`

- [ ] **Step 1: Create `mobile/components/ChatBubble.tsx`**

```typescript
import { View, Text } from 'react-native';
import type { Message } from '../types';

interface Props {
  message: Message;
}

export default function ChatBubble({ message }: Props) {
  const isUser = message.role === 'user';
  return (
    <View className={`px-4 py-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser ? 'bg-primary rounded-tr-sm' : 'bg-muted rounded-tl-sm'
        }`}
      >
        <Text className={`text-sm leading-5 ${isUser ? 'text-primary-foreground' : 'text-foreground'}`}>
          {message.content}
        </Text>
      </View>
      {message.attachments && message.attachments.length > 0 && (
        <View className={`mt-1 max-w-[85%] gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
          {message.attachments.map(att => (
            <View key={att.id} className="bg-muted rounded-lg px-3 py-1.5">
              <Text className="text-xs text-muted-foreground">📎 {att.filename}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Create `mobile/components/ExecutionCard.tsx`**

```typescript
import { View, Text } from 'react-native';
import type { Execution } from '../types';

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-500/20 text-blue-400',
  done: 'bg-green-500/20 text-green-400',
  error: 'bg-red-500/20 text-red-400',
  awaiting_approval: 'bg-yellow-500/20 text-yellow-400',
  cancelled: 'bg-muted text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  done: 'Done',
  error: 'Error',
  awaiting_approval: 'Waiting for approval',
  cancelled: 'Cancelled',
};

interface Props {
  execution: Execution;
}

export default function ExecutionCard({ execution }: Props) {
  const colorClass = STATUS_COLORS[execution.status] ?? 'bg-muted text-muted-foreground';
  const label = STATUS_LABELS[execution.status] ?? execution.status;

  return (
    <View className="mx-4 my-1 bg-muted rounded-xl p-3 gap-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-mono text-foreground">{execution.tool}</Text>
        <View className={`rounded-full px-2 py-0.5 ${colorClass.split(' ')[0]}`}>
          <Text className={`text-[10px] font-semibold ${colorClass.split(' ')[1]}`}>{label}</Text>
        </View>
      </View>
      {execution.error && (
        <Text className="text-xs text-red-400" numberOfLines={3}>{execution.error}</Text>
      )}
    </View>
  );
}
```

- [ ] **Step 3: Create `mobile/components/ApprovalCard.tsx`**

```typescript
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useApproveExecution, useRejectExecution } from '../hooks/useActivity';
import type { PendingApproval } from '../types';

interface Props {
  approval: PendingApproval;
}

export default function ApprovalCard({ approval }: Props) {
  const approve = useApproveExecution();
  const reject = useRejectExecution();
  const busy = approve.isPending || reject.isPending;

  return (
    <View className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 gap-3">
      <View className="gap-1">
        <Text className="text-xs font-semibold uppercase tracking-wider text-yellow-400">
          Action needed
        </Text>
        <Text className="text-sm font-medium text-foreground">{approval.action}</Text>
        {approval.session_id && (
          <Text className="text-xs text-muted-foreground">in chat</Text>
        )}
      </View>

      {approval.payload && (
        <View className="bg-black/20 rounded-lg p-2">
          <Text className="text-xs font-mono text-muted-foreground" numberOfLines={4}>
            {JSON.stringify(approval.payload, null, 2)}
          </Text>
        </View>
      )}

      <View className="flex-row gap-2">
        <TouchableOpacity
          className="flex-1 bg-primary rounded-xl py-2.5 items-center"
          onPress={() => approve.mutate(approval.execution_id)}
          disabled={busy}
        >
          {approve.isPending ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-primary-foreground text-sm font-semibold">Approve</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-muted rounded-xl py-2.5 items-center border border-border"
          onPress={() => reject.mutate(approval.execution_id)}
          disabled={busy}
        >
          {reject.isPending ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text className="text-muted-foreground text-sm font-medium">Reject</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add mobile/components/
git commit -m "feat(mobile): ChatBubble, ExecutionCard, ApprovalCard components"
```

---

## Task 11: Composer

**Files:**
- Create: `mobile/components/Composer.tsx`

- [ ] **Step 1: Create `mobile/components/Composer.tsx`**

```typescript
import { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

export interface AttachmentItem {
  uri: string;
  name: string;
  type: string;
}

interface Props {
  onSend: (content: string, attachments: AttachmentItem[]) => Promise<void>;
  disabled?: boolean;
}

const MAX_ATTACHMENTS = 8;
const MAX_BYTES = 10 * 1024 * 1024;

export default function Composer({ onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [sending, setSending] = useState(false);

  async function pickImage() {
    if (attachments.length >= MAX_ATTACHMENTS) { Alert.alert('Max 8 attachments'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      const picked = result.assets.map(a => ({
        uri: a.uri,
        name: a.fileName ?? `image_${Date.now()}.jpg`,
        type: a.mimeType ?? 'image/jpeg',
      }));
      setAttachments(prev => [...prev, ...picked].slice(0, MAX_ATTACHMENTS));
    }
  }

  async function pickDocument() {
    if (attachments.length >= MAX_ATTACHMENTS) { Alert.alert('Max 8 attachments'); return; }
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (!result.canceled) {
      const oversized = result.assets.filter(a => (a.size ?? 0) > MAX_BYTES);
      if (oversized.length > 0) { Alert.alert('Files must be under 10 MB'); return; }
      const picked = result.assets.map(a => ({ uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream' }));
      setAttachments(prev => [...prev, ...picked].slice(0, MAX_ATTACHMENTS));
    }
  }

  function removeAttachment(index: number) {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSend() {
    if (!text.trim() && attachments.length === 0) return;
    setSending(true);
    try {
      await onSend(text.trim(), attachments);
      setText('');
      setAttachments([]);
    } finally {
      setSending(false);
    }
  }

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !sending;

  return (
    <View className="border-t border-border px-3 pt-2 pb-4 gap-2">
      {attachments.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-2">
          {attachments.map((att, i) => (
            <TouchableOpacity
              key={i}
              className="bg-muted rounded-lg px-3 py-1.5 flex-row items-center gap-1.5 mr-2"
              onPress={() => removeAttachment(i)}
            >
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                📎 {att.name.length > 20 ? att.name.slice(0, 17) + '…' : att.name}
              </Text>
              <Text className="text-xs text-muted-foreground">×</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View className="flex-row items-end gap-2">
        <TouchableOpacity className="mb-1" onPress={pickImage} disabled={disabled}>
          <Text className="text-muted-foreground text-xl">🖼</Text>
        </TouchableOpacity>
        <TouchableOpacity className="mb-1" onPress={pickDocument} disabled={disabled}>
          <Text className="text-muted-foreground text-xl">📎</Text>
        </TouchableOpacity>
        <TextInput
          className="flex-1 bg-muted rounded-2xl px-4 py-2.5 text-foreground text-sm max-h-32"
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor="#666"
          multiline
          editable={!disabled && !sending}
        />
        <TouchableOpacity
          className={`w-9 h-9 rounded-full items-center justify-center mb-0.5 ${canSend ? 'bg-primary' : 'bg-muted'}`}
          onPress={handleSend}
          disabled={!canSend}
        >
          <Text className={`text-base ${canSend ? 'text-primary-foreground' : 'text-muted-foreground'}`}>↑</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/components/Composer.tsx
git commit -m "feat(mobile): Composer with image + document picker"
```

---

## Task 12: Chat Screen

**Files:**
- Create: `mobile/app/(drawer)/c/[chatId].tsx`

- [ ] **Step 1: Create `mobile/app/(drawer)/c/[chatId].tsx`**

```typescript
import { useEffect, useRef, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useMessages, useSendMessage } from '../../../hooks/useMessages';
import { useChatStatus } from '../../../hooks/useChatStatus';
import { subscribe } from '../../../lib/ws';
import { useAppStore } from '../../../lib/store';
import ChatBubble from '../../../components/ChatBubble';
import ExecutionCard from '../../../components/ExecutionCard';
import Composer from '../../../components/Composer';
import type { Message, WSEvent } from '../../../types';

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const listRef = useRef<FlatList>(null);

  const { data: messages = [], isLoading } = useMessages(chatId);
  const { data: status } = useChatStatus(chatId);
  const sendMessage = useSendMessage(chatId);

  // Subscribe to WebSocket events for this chat
  useEffect(() => {
    const unsub = subscribe((event: WSEvent) => {
      if (event.sessionId !== chatId) return;
      if (
        event.type === 'message_created' ||
        event.type === 'message_delta' ||
        event.type === 'turn_complete' ||
        event.type === 'execution_update'
      ) {
        qc.invalidateQueries({ queryKey: ['messages', chatId] });
        qc.invalidateQueries({ queryKey: ['chat-status', chatId] });
      }
      if (event.type === 'session_title_updated') {
        qc.invalidateQueries({ queryKey: ['chats'] });
      }
    });
    return unsub;
  }, [chatId, qc]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(
    async (content: string, attachments: Array<{ uri: string; name: string; type: string }>) => {
      await sendMessage.mutateAsync({ content, attachments });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200);
    },
    [sendMessage]
  );

  function renderItem({ item }: { item: Message }) {
    return (
      <View>
        <ChatBubble message={item} />
        {item.executions?.map(ex => <ExecutionCard key={ex.id} execution={ex} />)}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-foreground font-semibold text-sm" numberOfLines={1}>
            Chat
          </Text>
          {status?.active && (
            <Text className="text-xs text-muted-foreground">Agent running…</Text>
          )}
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      <Composer onSend={handleSend} disabled={status?.active} />
    </View>
  );
}
```

- [ ] **Step 2: Create `mobile/app/(drawer)/chats.tsx`**

```typescript
import { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useChats } from '../../hooks/useChats';
import type { Chat } from '../../types';

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ChatsScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { data: chats = [], isLoading } = useChats();

  const filtered = query.trim()
    ? chats.filter(c => (c.title ?? '').toLowerCase().includes(query.toLowerCase()))
    : chats;

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <Text className="text-foreground font-bold text-lg flex-1">Chats</Text>
      </View>

      <View className="px-4 py-2">
        <TextInput
          className="bg-muted rounded-xl px-4 py-2.5 text-foreground text-sm"
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats…"
          placeholderTextColor="#666"
        />
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          renderItem={({ item }: { item: Chat }) => (
            <TouchableOpacity
              className="px-4 py-3 border-b border-border/50"
              onPress={() => router.push(`/(drawer)/c/${item.id}`)}
            >
              <Text className="text-foreground font-medium text-sm" numberOfLines={1}>
                {item.title ?? 'Untitled chat'}
              </Text>
              <Text className="text-muted-foreground text-xs mt-0.5">{timeAgo(item.updated_at)}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View className="items-center mt-12">
              <Text className="text-muted-foreground text-sm">No chats yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add mobile/app/(drawer)/c/ mobile/app/(drawer)/chats.tsx
git commit -m "feat(mobile): chat screen with streaming updates and chats list"
```

---

## Task 13: Activity Screen

**Files:**
- Create: `mobile/app/(drawer)/activity.tsx`

- [ ] **Step 1: Create `mobile/app/(drawer)/activity.tsx`**

```typescript
import { useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useActivity } from '../../hooks/useActivity';
import { subscribe } from '../../lib/ws';
import { useAppStore } from '../../lib/store';
import ApprovalCard from '../../components/ApprovalCard';
import type { PendingApproval, WSEvent } from '../../types';

export default function ActivityScreen() {
  const navigation = useNavigation();
  const qc = useQueryClient();
  const { data: approvals = [], isLoading, refetch } = useActivity();
  const { setPendingApprovalCount } = useAppStore();

  // Keep badge in sync with fetched count
  useEffect(() => {
    setPendingApprovalCount(approvals.length);
  }, [approvals.length, setPendingApprovalCount]);

  // Real-time updates
  useEffect(() => {
    const unsub = subscribe((event: WSEvent) => {
      if (event.type === 'approval_requested' || event.type === 'execution_update') {
        qc.invalidateQueries({ queryKey: ['activity'] });
      }
    });
    return unsub;
  }, [qc]);

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <Text className="text-foreground font-bold text-lg">Activity</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={approvals}
          keyExtractor={a => a.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} />}
          renderItem={({ item }: { item: PendingApproval }) => <ApprovalCard approval={item} />}
          ListEmptyComponent={
            <View className="items-center mt-12 gap-2">
              <Text className="text-3xl">✓</Text>
              <Text className="text-muted-foreground text-sm">No pending approvals</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/(drawer)/activity.tsx
git commit -m "feat(mobile): activity screen with real-time approval updates"
```

---

## Task 14: Projects + Pipelines Screens

**Files:**
- Create: `mobile/app/(drawer)/projects/index.tsx`
- Create: `mobile/app/(drawer)/projects/[projectId]/index.tsx`
- Create: `mobile/app/(drawer)/projects/[projectId]/[tab].tsx`
- Create: `mobile/app/(drawer)/pipelines.tsx`

- [ ] **Step 1: Create `mobile/app/(drawer)/projects/index.tsx`**

```typescript
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useProjects } from '../../../hooks/useProjects';
import type { Project } from '../../../types';

export default function ProjectsScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { data: projects = [], isLoading } = useProjects();

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <Text className="text-foreground font-bold text-lg flex-1">Projects</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={p => p.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }: { item: Project }) => (
            <TouchableOpacity
              className="bg-muted rounded-xl p-4 gap-1"
              onPress={() => router.push(`/(drawer)/projects/${item.id}`)}
            >
              <Text className="text-foreground font-semibold">{item.name}</Text>
              {item.description && (
                <Text className="text-muted-foreground text-sm" numberOfLines={2}>{item.description}</Text>
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View className="items-center mt-12">
              <Text className="text-muted-foreground text-sm">No projects yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
```

- [ ] **Step 2: Create `mobile/app/(drawer)/projects/[projectId]/index.tsx`**

```typescript
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useProjectCampaigns, useArtifacts } from '../../../../hooks/useProjects';

const TABS = ['campaigns', 'artifacts', 'files', 'settings'] as const;

export default function ProjectDetailScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const { data: campaigns = [] } = useProjectCampaigns(projectId);
  const { data: artifacts = [] } = useArtifacts(projectId);

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-4 pt-4 gap-4">
        <View className="flex-row flex-wrap gap-2">
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab}
              className="bg-muted rounded-lg px-4 py-2"
              onPress={() => router.push(`/(drawer)/projects/${projectId}/${tab}`)}
            >
              <Text className="text-foreground capitalize text-sm font-medium">{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Campaigns ({campaigns.length})
          </Text>
          {campaigns.slice(0, 3).map(c => (
            <View key={c.id} className="bg-muted rounded-lg px-3 py-2">
              <Text className="text-foreground text-sm">{c.name}</Text>
              <Text className="text-muted-foreground text-xs">{c.status}</Text>
            </View>
          ))}
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Artifacts ({artifacts.length})
          </Text>
          {artifacts.slice(0, 3).map(a => (
            <View key={a.id} className="bg-muted rounded-lg px-3 py-2">
              <Text className="text-foreground text-sm">{a.name}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 3: Create `mobile/app/(drawer)/projects/[projectId]/[tab].tsx`**

```typescript
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useProjectCampaigns, useArtifacts } from '../../../../hooks/useProjects';

export default function ProjectTabScreen() {
  const { projectId, tab } = useLocalSearchParams<{ projectId: string; tab: string }>();
  const { data: campaigns = [], isLoading: loadingCampaigns } = useProjectCampaigns(projectId);
  const { data: artifacts = [], isLoading: loadingArtifacts } = useArtifacts(projectId);

  if (tab === 'campaigns') {
    return (
      <ScrollView className="flex-1 bg-background">
        <View className="p-4 gap-3">
          <Text className="text-foreground font-bold text-base">Campaigns</Text>
          {loadingCampaigns ? <ActivityIndicator /> : campaigns.map(c => (
            <View key={c.id} className="bg-muted rounded-xl p-4 gap-1">
              <Text className="text-foreground font-medium">{c.name}</Text>
              <Text className="text-muted-foreground text-xs capitalize">{c.status}</Text>
            </View>
          ))}
          {!loadingCampaigns && campaigns.length === 0 && (
            <Text className="text-muted-foreground text-sm">No campaigns</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  if (tab === 'artifacts') {
    return (
      <ScrollView className="flex-1 bg-background">
        <View className="p-4 gap-3">
          <Text className="text-foreground font-bold text-base">Artifacts</Text>
          {loadingArtifacts ? <ActivityIndicator /> : artifacts.map(a => (
            <View key={a.id} className="bg-muted rounded-xl p-4">
              <Text className="text-foreground font-medium">{a.name}</Text>
              <Text className="text-muted-foreground text-xs">{a.type}</Text>
            </View>
          ))}
          {!loadingArtifacts && artifacts.length === 0 && (
            <Text className="text-muted-foreground text-sm">No artifacts</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View className="flex-1 bg-background items-center justify-center">
      <Text className="text-muted-foreground capitalize">{tab} — coming soon</Text>
    </View>
  );
}
```

- [ ] **Step 4: Create `mobile/app/(drawer)/pipelines.tsx`**

```typescript
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { usePipelines } from '../../hooks/usePipelines';
import type { Pipeline } from '../../types';

export default function PipelinesScreen() {
  const navigation = useNavigation();
  const { data: pipelines = [], isLoading } = usePipelines();

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <Text className="text-foreground font-bold text-lg flex-1">Pipelines</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={pipelines}
          keyExtractor={p => p.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }: { item: Pipeline }) => (
            <View className="bg-muted rounded-xl p-4 gap-1">
              <Text className="text-foreground font-semibold">{item.name}</Text>
              {item.description && (
                <Text className="text-muted-foreground text-sm" numberOfLines={2}>{item.description}</Text>
              )}
            </View>
          )}
          ListEmptyComponent={
            <View className="items-center mt-12">
              <Text className="text-muted-foreground text-sm">No pipelines</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add mobile/app/(drawer)/projects/ mobile/app/(drawer)/pipelines.tsx
git commit -m "feat(mobile): projects, project detail, and pipelines screens"
```

---

## Task 15: Settings Screen

**Files:**
- Create: `mobile/app/(drawer)/settings.tsx`

- [ ] **Step 1: Create `mobile/app/(drawer)/settings.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, Switch } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useAppStore } from '../../lib/store';
import { getSavedHosts } from '../../lib/storage';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { serverUrl, signOut } = useAppStore();
  const [savedHosts, setSavedHosts] = useState<string[]>([]);

  useEffect(() => {
    getSavedHosts().then(setSavedHosts);
  }, []);

  function handleSignOut() {
    Alert.alert('Sign out', 'Sign out of this server?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <Text className="text-foreground font-bold text-lg">Settings</Text>
      </View>

      <View className="p-4 gap-6">
        {/* Current server */}
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Server</Text>
          <View className="bg-muted rounded-xl p-4 flex-row items-center justify-between">
            <Text className="text-foreground text-sm flex-1" numberOfLines={1}>{serverUrl}</Text>
            <TouchableOpacity onPress={() => router.push('/connect')}>
              <Text className="text-primary text-sm font-medium">Change</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Saved hosts */}
        {savedHosts.length > 1 && (
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Saved servers</Text>
            {savedHosts.map(host => (
              <TouchableOpacity
                key={host}
                className="bg-muted rounded-xl p-4"
                onPress={() => router.push('/connect')}
              >
                <Text className="text-foreground text-sm">{host}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Sign out */}
        <TouchableOpacity
          className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 items-center"
          onPress={handleSignOut}
        >
          <Text className="text-red-400 font-medium">Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/(drawer)/settings.tsx
git commit -m "feat(mobile): settings screen with server management"
```

---

## Task 16: Server — Push Token Storage

**Files:**
- Modify: `server/src/db/index.ts`
- Modify: `server/src/routes/settings.ts`

- [ ] **Step 1: Add migration in `server/src/db/index.ts`**

In the `applySchema()` function, after the existing `userSettingsCols` migration block (around line 302), add:

```typescript
  if (!userSettingsCols.some(c => c.name === 'expo_push_token')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN expo_push_token TEXT');
  }
```

- [ ] **Step 2: Add DB helpers in `server/src/db/index.ts`**

Add these two functions at the end of the file (before any closing braces):

```typescript
export function getExpoPushToken(userId: string): string | null {
  const row = getDb()
    .prepare('SELECT expo_push_token FROM user_settings WHERE user_id = ?')
    .get(userId) as { expo_push_token: string | null } | undefined;
  return row?.expo_push_token ?? null;
}

export function setExpoPushToken(userId: string, token: string | null): void {
  getDb().prepare(`
    INSERT INTO user_settings (user_id, expo_push_token)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET expo_push_token = excluded.expo_push_token
  `).run(userId, token);
}
```

- [ ] **Step 3: Accept `expoPushToken` in `server/src/routes/settings.ts`**

In the `router.put('/', ...)` handler, import and call the new helpers. Replace the handler body:

```typescript
import { getProjectsRoot, setProjectsRoot, getAgentBudgets, setAgentBudget, getPermissionProfile, setPermissionProfile, getExpoPushToken, setExpoPushToken } from '../db/index.js';

// In router.put('/', ...):
router.put('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { projects_root, permission_profile, expoPushToken } = req.body as {
    projects_root?: string;
    permission_profile?: unknown;
    expoPushToken?: string | null;
  };
  if (permission_profile !== undefined && !isPermissionProfile(permission_profile)) {
    res.status(400).json({ error: 'permission_profile must be one of fast, trusted, strict' });
    return;
  }
  setProjectsRoot(userId, projects_root?.trim() ?? '');
  if (permission_profile !== undefined) setPermissionProfile(userId, permission_profile);
  if (expoPushToken !== undefined) setExpoPushToken(userId, expoPushToken ?? null);
  res.json({
    projects_root: getProjectsRoot(userId),
    agent_budgets: getAgentBudgets(userId),
    permission_profile: getPermissionProfile(userId),
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add server/src/db/index.ts server/src/routes/settings.ts
git commit -m "feat(server): store Expo push token per user"
```

---

## Task 17: Server — Push Dispatch on Approval

**Files:**
- Modify: `server/src/services/executor.ts`

- [ ] **Step 1: Add push dispatch after approval broadcast in `server/src/services/executor.ts`**

After the line (around line 106):
```typescript
broadcast(userId, { type: 'approval_requested', sessionId: executionContext?.sessionId ?? null, executionId, approvalId, action, payload });
```

Add the following (import `getExpoPushToken` at the top of the file first):

At the top of `executor.ts`, add to the existing db import:
```typescript
import { /* existing imports */, getExpoPushToken } from '../db/index.js';
```

Then after the broadcast line:
```typescript
  // Send push notification if user has a registered token
  const pushToken = getExpoPushToken(userId);
  if (pushToken) {
    fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        title: 'Action needed',
        body: `${action} is waiting for your approval`,
        data: {
          sessionId: executionContext?.sessionId ?? null,
          executionId,
          approvalId,
        },
        sound: 'default',
        priority: 'high',
      }),
    }).catch(err => console.error('[push] Failed to send notification:', err));
  }
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/executor.ts
git commit -m "feat(server): send Expo push notification on approval_requested"
```

---

## Task 18: Mobile — Push Notifications

**Files:**
- Create: `mobile/lib/notifications.ts`

- [ ] **Step 1: Create `mobile/lib/notifications.ts`**

```typescript
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { apiFetch } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowList: true,
  }),
});

export async function registerPushToken(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('approvals', {
      name: 'Approvals',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return;

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const pushToken = tokenData.data;

  await apiFetch('/settings', {
    method: 'PUT',
    body: JSON.stringify({ expoPushToken: pushToken }),
  });
}

export function configurePushHandlers(
  onNotification: (data: { sessionId?: string; executionId?: string }) => void
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data as {
      sessionId?: string;
      executionId?: string;
    };
    onNotification(data);
  });

  return () => sub.remove();
}
```

- [ ] **Step 2: Wire push registration into root layout**

In `mobile/app/_layout.tsx`, after a successful auth check (when `token` and `serverUrl` are set), call `registerPushToken()`. Add the import and effect inside `AuthGate`:

```typescript
import { registerPushToken, configurePushHandlers } from '../lib/notifications';

// Inside AuthGate, add this effect after existing effects:
useEffect(() => {
  if (!token || !serverUrl) return;
  registerPushToken().catch(console.error);

  const unsub = configurePushHandlers(({ sessionId }) => {
    if (sessionId) {
      router.push(`/(drawer)/c/${sessionId}`);
    } else {
      router.push('/(drawer)/activity');
    }
  });

  return unsub;
}, [token, serverUrl]);
```

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/notifications.ts mobile/app/_layout.tsx
git commit -m "feat(mobile): Expo push notifications with approval deep links"
```

---

## Task 19: Web — Connect Mobile QR

**Files:**
- Modify: `web/src/pages/Settings.tsx`

- [ ] **Step 1: Install QR code library in web**

```bash
cd web && npm install qrcode.react
cd web && npm install --save-dev @types/qrcode.react
```

- [ ] **Step 2: Add "Connect Mobile" section to `web/src/pages/Settings.tsx`**

Import QRCode and `clearToken` (already imported). Near the top of the file, add:

```typescript
import { QRCodeSVG } from 'qrcode.react';
```

Add a `ConnectMobileSection` component before the default export:

```typescript
function ConnectMobileSection() {
  const [showQr, setShowQr] = useState(false);
  const token = localStorage.getItem('unnamedproject_token') ?? '';
  const url = window.location.origin.replace(/:\d+$/, ':3000');
  const qrValue = JSON.stringify({ url, token });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">Connect Mobile</div>
          <div className="text-xs text-muted-foreground">Scan from the Unnamed mobile app to connect instantly</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowQr(v => !v)}>
          {showQr ? 'Hide QR' : 'Show QR'}
        </Button>
      </div>
      {showQr && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-6 bg-white">
          <QRCodeSVG value={qrValue} size={200} />
          <p className="text-xs text-muted-foreground">Open the mobile app and tap "Scan QR code"</p>
        </div>
      )}
    </div>
  );
}
```

Add `<ConnectMobileSection />` inside the Settings page body where it's most visible (e.g., at the top of the first settings section, before Connections).

- [ ] **Step 3: Import `getToken` from web `lib/auth.ts` instead of hardcoding localStorage**

Replace the inline `localStorage.getItem` with the existing helper so the key stays in one place:

```typescript
import { getToken } from '../lib/auth';

// In ConnectMobileSection:
const token = getToken() ?? '';
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Settings.tsx web/package.json web/package-lock.json
git commit -m "feat(web): Connect Mobile QR code in settings"
```

---

## Self-Review Checklist

After implementing all tasks, verify:

- [ ] `npx jest` in `mobile/` — all tests pass
- [ ] `npx tsc --noEmit` in `mobile/` — no type errors
- [ ] App launches in Expo Go / simulator — reaches connect screen
- [ ] Manual URL entry navigates to login → drawer
- [ ] QR scan from web settings connects without login prompt
- [ ] Sending a message in a chat shows the response streaming in
- [ ] Creating an approval on the server triggers a push notification on device
- [ ] Tapping the notification opens the Activity screen
- [ ] Approve/reject from Activity screen resolves the approval
- [ ] Projects, Campaigns, Artifacts, Pipelines screens load without crash
- [ ] `npm run build` in `server/` — no TypeScript errors
- [ ] `npx tsc -b && vite build` in `web/` — no errors
