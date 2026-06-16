import { create } from 'zustand';
import {
  setToken as persistToken,
  clearToken,
  setServerUrl as persistUrl,
  addSavedHost,
  setThemePreference as persistThemePreference,
  type ThemePreference,
} from './storage';

export type WsStatus = 'connected' | 'connecting' | 'disconnected';

interface AppState {
  serverUrl: string | null;
  token: string | null;
  wsStatus: WsStatus;
  pendingApprovalCount: number;
  themePreference: ThemePreference;
  setServerUrl: (url: string) => Promise<void>;
  setToken: (token: string) => Promise<void>;
  setThemePreference: (preference: ThemePreference) => Promise<void>;
  signOut: () => Promise<void>;
  hydrate: (serverUrl: string | null, token: string | null, themePreference: ThemePreference) => void;
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
  themePreference: 'system',

  setServerUrl: async (url) => {
    await persistUrl(url);
    await addSavedHost(url);
    set({ serverUrl: url });
  },

  setToken: async (token) => {
    await persistToken(token);
    set({ token });
  },

  setThemePreference: async (themePreference) => {
    await persistThemePreference(themePreference);
    set({ themePreference });
  },

  signOut: async () => {
    await clearToken();
    set({ token: null, pendingApprovalCount: 0, wsStatus: 'disconnected' });
  },

  hydrate: (serverUrl, token, themePreference) => set({ serverUrl, token, themePreference }),

  setWsStatus: (wsStatus) => set({ wsStatus }),

  setPendingApprovalCount: (pendingApprovalCount) => set({ pendingApprovalCount }),

  incrementPendingApprovals: () =>
    set(s => ({ pendingApprovalCount: s.pendingApprovalCount + 1 })),

  decrementPendingApprovals: () =>
    set(s => ({ pendingApprovalCount: Math.max(0, s.pendingApprovalCount - 1) })),
}));
